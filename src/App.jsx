import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import * as pdfjsLib from 'pdfjs-dist'
import pdfjsWorker from 'pdfjs-dist/build/pdf.worker?url'
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker
import {
  supabase, signInWithGoogle, signOut, onAuthChange, getSession, getUserInfo,
  getClients, getBilling,
  getClientEntities, upsertClientEntity, deleteClientEntity, getAllEntities,
  getDriveToken, connectDrive, saveDriveToken,
  upsertClient, deleteClient as dbDeleteClient,
  upsertBilling, updateBillingStatus
} from './supabase'

const FONT = "https://fonts.googleapis.com/css2?family=DM+Sans:opsz,wght@9..40,300;9..40,400;9..40,500;9..40,600;9..40,700&display=swap"
const C = {
  bg:'#F5F5F5',surface:'#FFFFFF',card:'#FFFFFF',border:'#E4E4E4',text:'#3D3D3D',muted:'#8A8A8A',
  accent:'#003C50',overdue:'#C2382B',urgent:'#C2382B',soon:'#C77F18',normal:'#2E7D55',done:'#A8A8A8',
}
const fmt = n => new Intl.NumberFormat('es-CL',{style:'currency',currency:'CLP',maximumFractionDigits:0}).format(n||0)
const fmtUF = n => n ? `UF ${Number(n).toLocaleString('es-CL',{minimumFractionDigits:2,maximumFractionDigits:2})}` : '—'
const fmtDate = d => { if(!d) return '—'; return new Date(d+'T12:00').toLocaleDateString('es-CL',{day:'2-digit',month:'short'}) }
const daysLeft = d => { if(!d) return null; return Math.round((new Date(d+'T12:00') - new Date()) / 86400000) }
const urgency = (due,status) => {
  if(['Completado','Pagado','Archivado','Anulado'].includes(status)) return 'done'
  const d = daysLeft(due); if(d===null) return 'normal'
  if(d<0) return 'overdue'; if(d<=5) return 'urgent'; if(d<=14) return 'soon'; return 'normal'
}
function normRut(r){ return (r||'').replace(/\s/g,'').replace(/\./g,'').toLowerCase() }
function dueFromIssued(iso){ if(!iso) return null; const d=new Date(iso+'T00:00:00'); d.setDate(d.getDate()+30); return d.toISOString().slice(0,10) }
const urgencyColor = (due,status) => ({overdue:C.overdue,urgent:C.urgent,soon:C.soon,normal:C.normal,done:C.done})[urgency(due,status)]||C.muted
const currentYear = new Date().getFullYear()
const currentMonth = new Date().getMonth()+1

const DaysBadge = ({due,status}) => {
  const u=urgency(due,status); if(u==='done') return null
  const d=daysLeft(due); if(d===null) return null
  const label=d<0?`${Math.abs(d)}d vencido`:d===0?'hoy':`${d}d`
  return <span style={{fontSize:10,fontWeight:600,color:urgencyColor(due,status),whiteSpace:'nowrap'}}>{label}</span>
}
const AreaChip = ({area}) => {
  const bg={Corporativo:'#E3EEF3',Tributario:'#F2E9DE',Laboral:'#F2E9DE',Otro:'#ECECEC'}
  return <span style={{fontSize:10,padding:'1px 7px',borderRadius:3,background:bg[area]||'#ECECEC',color:'#56616B',fontWeight:600,whiteSpace:'nowrap'}}>{area}</span>
}
const Pill = ({label,bg,color,small}) => <span style={{display:'inline-block',padding:small?'1px 7px':'2px 9px',borderRadius:20,fontSize:small?10:11,fontWeight:600,color:color||'#fff',background:bg||C.accent,whiteSpace:'nowrap'}}>{label}</span>
const Inp = (p) => <input {...p} style={{width:'100%',padding:'10px 12px',borderRadius:8,border:`1px solid ${C.border}`,background:'#F7F7F7',color:C.text,fontSize:14,boxSizing:'border-box',outline:'none',...p.style}}/>
const Sel = ({value,onChange,options,placeholder}) => (
  <select value={value} onChange={onChange} style={{width:'100%',padding:'10px 12px',borderRadius:8,border:`1px solid ${C.border}`,background:'#F7F7F7',color:C.text,fontSize:14,boxSizing:'border-box'}}>
    {placeholder&&<option value=''>{placeholder}</option>}
    {options.map(o=><option key={o} value={o}>{o}</option>)}
  </select>
)
const Txt = (p) => <textarea {...p} rows={2} style={{width:'100%',padding:'10px 12px',borderRadius:8,border:`1px solid ${C.border}`,background:'#F7F7F7',color:C.text,fontSize:14,resize:'none',boxSizing:'border-box',outline:'none'}}/>
const Lbl = ({children}) => <div style={{fontSize:11,fontWeight:600,color:C.muted,textTransform:'uppercase',letterSpacing:.7,marginBottom:5}}>{children}</div>
const Fld = ({label,children}) => <div style={{marginBottom:14}}><Lbl>{label}</Lbl>{children}</div>
const Spin = () => <div style={{width:20,height:20,border:`2px solid ${C.border}`,borderTopColor:C.accent,borderRadius:'50%',animation:'spin .7s linear infinite'}}/>
const Modal = ({title,onClose,children}) => (
  <div style={{position:'fixed',inset:0,background:'rgba(20,30,35,.45)',zIndex:200,display:'flex',alignItems:'center',justifyContent:'center',padding:16}} onClick={e=>e.target===e.currentTarget&&onClose()}>
    <div style={{background:C.surface,borderRadius:16,width:'100%',maxWidth:520,maxHeight:'90vh',overflowY:'auto',boxShadow:'0 20px 60px rgba(0,0,0,.18)',border:`1px solid ${C.border}`,paddingBottom:24}}>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'18px 20px 14px',borderBottom:`1px solid ${C.border}`,position:'sticky',top:0,background:C.surface,zIndex:1}}>
        <span style={{fontSize:16,fontWeight:600,color:C.text,fontFamily:"'DM Sans',sans-serif",letterSpacing:-.4}}>{title}</span>
        <button onClick={onClose} style={{background:'none',border:'none',color:C.muted,fontSize:24,cursor:'pointer',lineHeight:1}}>x</button>
      </div>
      <div style={{padding:'18px 20px'}}>{children}</div>
    </div>
  </div>
)

function LoginScreen({loading}) {
  return (
    <div style={{minHeight:'100vh',background:C.bg,display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',padding:32}}>
      <div style={{fontSize:11,color:C.muted,letterSpacing:2,textTransform:'uppercase',marginBottom:8}}>Bienvenido a</div>
      <div style={{fontSize:32,fontWeight:600,color:C.text,fontFamily:"'DM Sans',sans-serif",letterSpacing:-.4,marginBottom:4}}>Liberona Escala</div>
      <div style={{fontSize:13,color:C.muted,marginBottom:48}}>Gestion del Estudio</div>
      <button onClick={signInWithGoogle} disabled={loading} style={{display:'flex',alignItems:'center',gap:12,padding:'14px 28px',borderRadius:12,border:`1px solid ${C.border}`,background:C.surface,color:C.text,fontSize:14,fontWeight:600,cursor:'pointer',width:'100%',maxWidth:300,justifyContent:'center'}}>
        {loading?<Spin/>:<>
          <svg width="18" height="18" viewBox="0 0 24 24"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/></svg>
          Entrar con Google Workspace
        </>}
      </button>
      <div style={{fontSize:11,color:C.muted,marginTop:16}}>Solo cuentas @leabogados.cl</div>
    </div>
  )
}

const TABS_ADMIN = [
  {id:'dashboard',icon:'house',label:'Inicio'},
  {id:'sales',icon:'tag',label:'Ventas'},
  {id:'billing',icon:'dollar',label:'Facturación'},
  {id:'expenses',icon:'minus',label:'Gastos'},
  {id:'clients',icon:'person',label:'Clientes'},
]
const TABS_LIMITED = [
  {id:'tasks',icon:'check',label:'Tareas'},
  {id:'expenses',icon:'minus',label:'Gastos'},
]

function BottomNav({tab,setTab,overdueN,userRole}) {
  const tabs = userRole==='admin' ? TABS_ADMIN : TABS_LIMITED
  const icons = {house:'⌂',tag:'◈',dollar:'$',minus:'⊖',person:'⊙',check:'✓'}
  return (
    <div className='bottomnav' style={{position:'fixed',bottom:0,left:0,right:0,background:C.surface,borderTop:`1px solid ${C.border}`,display:'flex',zIndex:50,paddingBottom:'env(safe-area-inset-bottom,0)'}}>
      <style>{`
        @media(min-width:768px){
          .bottomnav { border-radius: 0; max-width: none; }
          .bottomnav button { padding: 14px 0 12px !important; }
          .bottomnav button span:first-child { font-size: 22px !important; }
          .bottomnav button span:last-child { font-size: 12px !important; }
        }
      `}</style>
      {tabs.map(t=>(
        <button key={t.id} onClick={()=>setTab(t.id)} style={{flex:1,padding:'10px 0 8px',background:'none',border:'none',cursor:'pointer',display:'flex',flexDirection:'column',alignItems:'center',gap:3,position:'relative',minWidth:0}}>
          <span style={{fontSize:16,lineHeight:1,color:tab===t.id?C.accent:C.muted}}>{icons[t.icon]}</span>
          <span style={{fontSize:10,color:tab===t.id?C.accent:C.muted,fontWeight:tab===t.id?700:400,whiteSpace:'nowrap'}}>{t.label}</span>
          {t.id==='billing'&&overdueN>0&&<span style={{position:'absolute',top:4,right:'calc(50% - 16px)',background:C.overdue,color:'#fff',borderRadius:10,fontSize:9,fontWeight:700,padding:'1px 5px'}}>{overdueN}</span>}
        </button>
      ))}
    </div>
  )
}

const WHO_LIST = ['Cristóbal','Martín','Martina','Erasmo']

function TasksByPerson({tasks,clients}) {
  const [open,setOpen] = useState(null)
  const active = tasks?.filter(t=>t.status==='Activo')||[]

  return (
    <div>
      {WHO_LIST.map(who=>{
        const mine = active.filter(t=>t.who===who)
          .sort((a,b)=>(daysLeft(a.due)||999)-(daysLeft(b.due)||999))
        if(mine.length===0) return null
        const overdueN = mine.filter(t=>urgency(t.due,t.status)==='overdue').length
        const urgentN  = mine.filter(t=>urgency(t.due,t.status)==='urgent').length
        const isOpen = open===who
        return (
          <div key={who} style={{marginBottom:8,borderRadius:10,border:`1px solid ${C.border}`,overflow:'hidden',background:C.card}}>
            <button onClick={()=>setOpen(isOpen?null:who)} style={{width:'100%',padding:'12px 14px',background:'none',border:'none',cursor:'pointer',display:'flex',justifyContent:'space-between',alignItems:'center',textAlign:'left'}}>
              <div style={{display:'flex',alignItems:'center',gap:10}}>
                <div style={{width:32,height:32,borderRadius:'50%',background:'#E6EEF1',display:'flex',alignItems:'center',justifyContent:'center',fontSize:13,fontWeight:700,color:C.accent,flexShrink:0}}>
                  {who[0]}
                </div>
                <div>
                  <div style={{fontSize:13,fontWeight:600,color:C.text}}>{who}</div>
                  <div style={{fontSize:11,color:C.muted}}>{mine.length} tarea{mine.length!==1?'s':''} pendiente{mine.length!==1?'s':''}</div>
                </div>
              </div>
              <div style={{display:'flex',alignItems:'center',gap:6}}>
                {overdueN>0&&<span style={{fontSize:10,fontWeight:700,color:'#fff',background:C.overdue,borderRadius:10,padding:'2px 7px'}}>{overdueN} venc.</span>}
                {urgentN>0&&overdueN===0&&<span style={{fontSize:10,fontWeight:700,color:'#fff',background:C.soon,borderRadius:10,padding:'2px 7px'}}>{urgentN} urgente{urgentN!==1?'s':''}</span>}
                <span style={{fontSize:16,color:C.muted,transform:isOpen?'rotate(180deg)':'none',transition:'transform .2s'}}>▾</span>
              </div>
            </button>
            {isOpen&&(
              <div style={{borderTop:`1px solid ${C.border}`}}>
                {mine.map(t=>{
                  const client=clients.find(c=>c.id===t.client_id)
                  const u=urgency(t.due,t.status)
                  const rowColor = u==='overdue'?'#FBE9E7':u==='urgent'?'#FFF8EC':u==='soon'?'#FFFBF0':'#fff'
                  return (
                    <div key={t.id} style={{padding:'10px 14px',borderBottom:`1px solid ${C.border}`,background:rowColor,display:'flex',gap:10,alignItems:'flex-start'}}>
                      <div style={{width:7,height:7,borderRadius:'50%',background:urgencyColor(t.due,t.status),flexShrink:0,marginTop:4}}/>
                      <div style={{flex:1,minWidth:0}}>
                        {/* Línea 1: contexto (cliente · proyecto › subproyecto · días) */}
                        <div style={{fontSize:11,color:C.muted,display:'flex',gap:6,alignItems:'center',flexWrap:'wrap',marginBottom:2}}>
                          <span style={{overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{client?.name?.split('/')[0].trim()||'—'}</span>
                          {t.project&&<><span>·</span><span style={{overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{t.project}{t.subproject?` › ${t.subproject}`:''}</span></>}
                          {t.due&&<><span>·</span><DaysBadge due={t.due} status={t.status}/></>}
                        </div>
                        {/* Línea 2: la tarea, en cursiva */}
                        <div style={{fontSize:13,fontWeight:500,fontStyle:'italic',color:C.text}}>{t.title}</div>
                        {/* Línea 3: nota, más tenue */}
                        {t.note&&<div style={{fontSize:11,color:C.muted,opacity:.75,marginTop:2,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{t.note}</div>}
                      </div>
                      {u==='overdue'&&<span style={{fontSize:10,fontWeight:700,color:C.overdue,flexShrink:0}}>VENCIDA</span>}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

// ─── DASHBOARD ────────────────────────────────────────────────────────────────
const META_UF = 9800
const META_CLP = 400000000

function CashflowProjection({billing}) {
  const [horizon,setHorizon] = useState(3) // 3 | 6 | 12 meses
  const pending = billing.filter(b=>['Pendiente','Vencido'].includes(b.status)&&b.due)
  const programadas = billing.filter(b=>b.status==='Programada'&&b.due)

  const months = useMemo(()=>{
    const result = []
    const now = new Date()
    for(let i=0;i<horizon;i++){
      const d = new Date(now.getFullYear(), now.getMonth()+i, 1)
      const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`
      const label = d.toLocaleDateString('es-CL',{month:'short',year:'2-digit'})
      const emitidoMes = pending.filter(b=>b.due?.startsWith(key)).reduce((a,b)=>a+(b.amount||0),0)
      const overdue = pending.filter(b=>b.due<key.slice(0,7)+'-01'&&i===0).reduce((a,b)=>a+(b.amount||0),0)
      const emitido = i===0?emitidoMes+overdue:emitidoMes
      const programado = programadas.filter(b=>b.due?.startsWith(key)).reduce((a,b)=>a+(b.amount||0),0)
      result.push({key,label,emitido,programado,total:emitido+programado,overdue:i===0?overdue:0})
    }
    return result
  },[billing,horizon])

  const maxVal = Math.max(...months.map(m=>m.total),1)
  const totalHorizon = months.reduce((a,m)=>a+m.total,0)
  const totalEmitido = months.reduce((a,m)=>a+m.emitido,0)
  const totalProgramado = months.reduce((a,m)=>a+m.programado,0)

  return (
    <div style={{padding:'16px 20px 0'}}>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:12}}>
        <div style={{fontSize:11,fontWeight:600,color:C.muted,textTransform:'uppercase',letterSpacing:.5}}>Proyección de caja</div>
        <div style={{display:'flex',gap:4}}>
          {[[3,'3M'],[6,'6M'],[12,'12M']].map(([v,l])=>(
            <button key={v} onClick={()=>setHorizon(v)} style={{padding:'3px 10px',borderRadius:6,border:`1px solid ${horizon===v?C.accent:C.border}`,background:horizon===v?'#E6EEF1':'transparent',color:horizon===v?C.accent:C.muted,fontSize:11,fontWeight:600,cursor:'pointer'}}>{l}</button>
          ))}
        </div>
      </div>
      <div style={{background:C.card,borderRadius:12,padding:'12px 14px',border:`1px solid ${C.border}`,marginBottom:6}}>
        <div style={{fontSize:11,color:C.muted,marginBottom:2}}>Total esperado {horizon} meses: <strong style={{color:C.text,fontSize:13}}>{fmt(totalHorizon)}</strong></div>
        <div style={{display:'flex',gap:12,marginBottom:8,fontSize:10,color:C.muted}}>
          <span style={{display:'flex',alignItems:'center',gap:4}}><span style={{width:8,height:8,borderRadius:2,background:C.accent,display:'inline-block'}}/>Emitido {fmt(totalEmitido)}</span>
          <span style={{display:'flex',alignItems:'center',gap:4}}><span style={{width:8,height:8,borderRadius:2,background:'#7C5CBF',display:'inline-block'}}/>Programado {fmt(totalProgramado)}</span>
        </div>
        <div style={{display:'flex',gap:4,alignItems:'flex-end',height:64}}>
          {months.map(m=>(
            <div key={m.key} style={{flex:1,display:'flex',flexDirection:'column',alignItems:'center',gap:3}}>
              <div style={{fontSize:9,color:C.muted,fontWeight:600}}>{m.total>0?fmt(m.total).replace('$','').replace('.000','k'):''}</div>
              <div style={{width:'100%',borderRadius:3,overflow:'hidden',background:'#E8EEF0',height:40,display:'flex',flexDirection:'column',justifyContent:'flex-end'}}>
                {m.programado>0&&<div style={{width:'100%',background:'#7C5CBF',height:`${Math.round((m.programado/maxVal)*100)}%`,minHeight:2}}/>}
                {m.emitido>0&&<div style={{width:'100%',background:m.overdue>0?C.overdue:C.accent,height:`${Math.round((m.emitido/maxVal)*100)}%`,minHeight:2}}/>}
              </div>
              <div style={{fontSize:9,color:C.muted,textAlign:'center'}}>{m.label}</div>
            </div>
          ))}
        </div>
      </div>
      {months[0]?.overdue>0&&<div style={{fontSize:11,color:C.overdue,fontWeight:600,marginTop:4}}>⚠ Incluye {fmt(months[0].overdue)} vencido en este mes</div>}
    </div>
  )
}

function PorFacturarMes({billing,clients}) {
  const [abierto,setAbierto] = useState(false)
  const [openClient,setOpenClient] = useState(null)
  const now = new Date()
  const key = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`
  const mesLabel = now.toLocaleDateString('es-CL',{month:'long'})
  const delMes = billing.filter(b=>b.status==='Programada'&&b.due?.startsWith(key))
  const total = delMes.reduce((a,b)=>a+(b.amount||0),0)

  // Agrupar por cliente
  const porCliente = useMemo(()=>{
    const g = {}
    delMes.forEach(b=>{
      const c = clients.find(x=>x.id===b.client_id)
      const cid = b.client_id||'__none__'
      const cname = c?.name||'Sin cliente'
      if(!g[cid]) g[cid] = {name:cname, items:[], total:0}
      g[cid].items.push(b); g[cid].total += (b.amount||0)
    })
    return Object.entries(g).map(([id,v])=>({id,...v})).sort((a,b)=>b.total-a.total)
  },[billing])

  if(delMes.length===0) return null

  // Sub-agrupar las cuotas de un cliente por razón social
  const porRazon = (items) => {
    const g = {}
    items.forEach(b=>{
      const rkey = b.receptor_name||'Sin razón social'
      if(!g[rkey]) g[rkey] = {name:rkey, rut:b.receptor_rut||null, total:0, n:0}
      g[rkey].total += (b.amount||0); g[rkey].n += 1
    })
    return Object.values(g)
  }

  return (
    <div style={{padding:'16px 20px 0'}}>
      <div style={{fontSize:11,fontWeight:600,color:C.muted,textTransform:'uppercase',letterSpacing:.5,marginBottom:8}}>Por facturar este mes</div>
      <div style={{background:C.card,borderRadius:12,border:`1px solid ${C.border}`,overflow:'hidden'}}>
        {/* Fila resumen */}
        <div onClick={()=>setAbierto(o=>!o)} style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'12px 14px',cursor:'pointer'}}>
          <div style={{display:'flex',alignItems:'center',gap:8}}>
            <span style={{fontSize:11,color:C.muted,transform:abierto?'rotate(90deg)':'none',transition:'transform .15s'}}>▶</span>
            <span style={{fontSize:13,color:C.text,fontWeight:600,textTransform:'capitalize'}}>{mesLabel}</span>
            <span style={{fontSize:11,color:C.muted}}>· {delMes.length} factura{delMes.length!==1?'s':''}</span>
          </div>
          <span style={{fontSize:14,fontWeight:700,color:C.accent}}>{fmt(total)}</span>
        </div>
        {/* Detalle por cliente */}
        {abierto&&porCliente.map(cl=>(
          <div key={cl.id} style={{borderTop:`1px solid ${C.border}`}}>
            <div onClick={()=>setOpenClient(o=>o===cl.id?null:cl.id)} style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'10px 14px 10px 28px',cursor:'pointer'}}>
              <div style={{display:'flex',alignItems:'center',gap:6}}>
                <span style={{fontSize:10,color:C.muted,transform:openClient===cl.id?'rotate(90deg)':'none',transition:'transform .15s'}}>▶</span>
                <span style={{fontSize:13,color:C.text}}>{cl.name}</span>
                <span style={{fontSize:11,color:C.muted}}>· {cl.items.length}</span>
              </div>
              <span style={{fontSize:13,fontWeight:600,color:C.text}}>{fmt(cl.total)}</span>
            </div>
            {/* Razones sociales + RUT */}
            {openClient===cl.id&&porRazon(cl.items).map((r,i)=>(
              <div key={i} style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'7px 14px 7px 46px',background:'#FAFBFC',borderTop:`1px solid ${C.border}`}}>
                <div style={{minWidth:0}}>
                  <div style={{fontSize:12,color:C.text,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{r.name}</div>
                  {r.rut&&<div style={{fontSize:10,color:C.muted}}>{r.rut}</div>}
                </div>
                <div style={{fontSize:11,color:C.muted,flexShrink:0,marginLeft:8}}>{r.n} · {fmt(r.total)}</div>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}

function Dashboard({sales,billing,clients,expenses,tasks,hideErasmo,setTab,user}) {
  const yr = currentYear
  const bb = hideErasmo ? billing.filter(b=>!b.erasmo) : billing
  const salesYr = sales.filter(s=>s.year===yr)

  const vendidoBrutoUF = salesYr.reduce((a,s)=>a+(parseFloat(s.amount_uf)||0),0)
  const costoUF = salesYr.reduce((a,s)=>a+(parseFloat(s.cost_uf)||0),0)
  const vendidoNetoUF = vendidoBrutoUF - costoUF
  const ufRef = salesYr.find(s=>s.uf_value)?.uf_value || 40000
  const vendidoBrutoCLP = salesYr.reduce((a,s)=>{ const clp=s.amount_clp||(s.amount_uf&&s.uf_value?Math.round(s.amount_uf*s.uf_value):Math.round((parseFloat(s.amount_uf)||0)*ufRef)); return a+clp },0)
  const costoCLP = Math.round(costoUF * ufRef)
  const vendidoNetoCLP = vendidoBrutoCLP - costoCLP
  const pctMeta = Math.min(100, Math.round((vendidoNetoUF/META_UF)*100))

  const facturado = bb.filter(b=>b.issued_at?.startsWith(String(yr))&&b.billing_type!=='reembolso').reduce((a,b)=>a+(b.amount||0),0)
  const cobrado = bb.filter(b=>b.status==='Pagado'&&b.billing_type!=='reembolso'&&(b.paid_at?.startsWith(String(yr))||b.issued_at?.startsWith(String(yr)))).reduce((a,b)=>a+(b.amount||0),0)
  const tasaCobro = facturado>0 ? Math.round((cobrado/facturado)*100) : 0

  const porCobrar = bb.filter(b=>['Pendiente','Vencido'].includes(b.status))
  const totalPorCobrar = porCobrar.reduce((a,b)=>a+(b.amount||0),0)
  const age0_30  = porCobrar.filter(b=>{ const d=daysLeft(b.due); return d!==null&&d>=-30 }).reduce((a,b)=>a+(b.amount||0),0)
  const age31_60 = porCobrar.filter(b=>{ const d=daysLeft(b.due); return d!==null&&d<-30&&d>=-60 }).reduce((a,b)=>a+(b.amount||0),0)
  const age60p   = porCobrar.filter(b=>{ const d=daysLeft(b.due); return d!==null&&d<-60 }).reduce((a,b)=>a+(b.amount||0),0)
  const top5 = [...porCobrar].sort((a,b)=>(daysLeft(a.due)||0)-(daysLeft(b.due)||0)).slice(0,5)

  const byArea = {}
  salesYr.forEach(s=>{ byArea[s.area]=(byArea[s.area]||0)+(parseFloat(s.amount_uf)||0) })
  const topAreas = Object.entries(byArea).sort((a,b)=>b[1]-a[1]).slice(0,3)

  const balances = {}
  expenses.forEach(e=>{ balances[e.client_id]=(balances[e.client_id]||0)+(e.type==='fondo'?e.amount:-e.amount) })
  const negatives = clients.filter(c=>balances[c.id]<0)

  return (
    <div>
      <div style={{padding:'20px 20px 0'}}>
        <div style={{fontSize:11,color:C.muted,fontWeight:500,letterSpacing:.5,marginBottom:2}}>{new Date().toLocaleDateString('es-CL',{weekday:'long',day:'numeric',month:'long'}).replace(/^\w/,c=>c.toUpperCase())}</div>
        <div style={{fontSize:26,fontWeight:600,color:C.text,fontFamily:"'DM Sans',sans-serif",letterSpacing:-.4,lineHeight:1.1,marginBottom:2}}>Buenas, {user?.name?.split(' ')[0]}</div>
        <div style={{fontSize:12,color:C.muted,marginBottom:16}}>Liberona Escala Abogados</div>
      </div>

      {/* Meta anual */}
      <div style={{padding:'0 20px 16px'}}>
        <div style={{background:C.card,borderRadius:12,padding:'14px 16px',border:`1px solid ${C.border}`}}>
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:10}}>
            <div>
              <div style={{fontSize:11,fontWeight:600,color:C.muted,textTransform:'uppercase',letterSpacing:.5,marginBottom:2}}>Meta {yr}</div>
              <div style={{fontSize:11,color:C.muted}}>UF {META_UF.toLocaleString('es-CL')} · {fmt(META_CLP)}</div>
            </div>
            <div style={{textAlign:'right'}}>
              <div style={{fontSize:22,fontWeight:700,color:pctMeta>=100?C.normal:C.accent}}>{pctMeta}%</div>
              <div style={{fontSize:10,color:C.muted}}>completado</div>
            </div>
          </div>
          <div style={{height:8,borderRadius:4,background:'#E8EEF0',marginBottom:12,overflow:'hidden'}}>
            <div style={{height:'100%',borderRadius:4,background:pctMeta>=100?C.normal:C.accent,width:`${pctMeta}%`,transition:'width .5s ease'}}/>
          </div>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8}}>
            {[
              ['Bruto',fmtUF(vendidoBrutoUF),fmt(vendidoBrutoCLP),'#E3EEF3',C.accent],
              ['Costo',costoUF>0?fmtUF(costoUF):'-',costoUF>0?fmt(costoCLP):'-','#FBE9E7',C.overdue],
              ['Neto',fmtUF(vendidoNetoUF),fmt(vendidoNetoCLP),'#E4F1EA',C.normal],
            ].map(([l,v,sub,bg,col])=>(
              <div key={l} style={{background:bg,borderRadius:8,padding:'8px 10px'}}>
                <div style={{fontSize:10,color:C.muted,marginBottom:3,fontWeight:600,textTransform:'uppercase',letterSpacing:.4}}>{l}</div>
                <div style={{fontSize:12,fontWeight:700,color:col}}>{v}</div>
                <div style={{fontSize:10,color:C.muted,marginTop:1}}>{sub}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Facturación */}
      <div style={{padding:'0 20px 16px'}}>
        <div style={{fontSize:11,fontWeight:600,color:C.muted,textTransform:'uppercase',letterSpacing:.5,marginBottom:8}}>Facturación {yr}</div>
        {(()=>{
          const terceros = bb.filter(b=>b.issued_at?.startsWith(String(yr))&&b.billing_type!=='reembolso').reduce((a,b)=>a+(Number(b.monto_terceros)||0),0)
          const netoFirma = facturado - terceros
          return (
            <>
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8,marginBottom:6}}>
                {[['Facturado (bruto)',fmt(facturado),'#EEF3E3',C.normal],['Cobrado',fmt(cobrado),'#E4F1EA',C.normal]].map(([l,v,bg,col])=>(
                  <div key={l} style={{background:bg,borderRadius:10,padding:'10px 12px',border:`1px solid ${C.border}`}}>
                    <div style={{fontSize:10,color:C.muted,marginBottom:3,textTransform:'uppercase',letterSpacing:.4,fontWeight:600}}>{l}</div>
                    <div style={{fontSize:13,fontWeight:700,color:col}}>{v}</div>
                  </div>
                ))}
              </div>
              {terceros>0&&(
                <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8,marginBottom:6}}>
                  <div style={{background:'#F0F4F8',borderRadius:10,padding:'10px 12px',border:`1px solid ${C.border}`}}>
                    <div style={{fontSize:10,color:C.muted,marginBottom:3,textTransform:'uppercase',letterSpacing:.4,fontWeight:600}}>Neto firma</div>
                    <div style={{fontSize:13,fontWeight:700,color:C.accent}}>{fmt(netoFirma)}</div>
                  </div>
                  <div style={{background:'#F7F2EC',borderRadius:10,padding:'10px 12px',border:`1px solid ${C.border}`}}>
                    <div style={{fontSize:10,color:C.muted,marginBottom:3,textTransform:'uppercase',letterSpacing:.4,fontWeight:600}}>Terceros</div>
                    <div style={{fontSize:13,fontWeight:700,color:'#8B5C2A'}}>{fmt(terceros)}</div>
                  </div>
                </div>
              )}
              {facturado>0&&<div style={{fontSize:12,color:C.muted,textAlign:'right',marginBottom:6}}>Tasa de cobro: <span style={{fontWeight:700,color:tasaCobro>=80?C.normal:tasaCobro>=50?C.soon:C.overdue}}>{tasaCobro}%</span></div>}
            </>
          )
        })()}
      </div>

      {/* Cobranza */}
      <div style={{padding:'0 20px'}}>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:8}}>
          <div style={{fontSize:11,fontWeight:600,color:C.muted,textTransform:'uppercase',letterSpacing:.5}}>Cobranza</div>
          <button onClick={()=>setTab('billing')} style={{background:'none',border:'none',color:C.accent,fontSize:12,cursor:'pointer',fontWeight:600}}>Ver todos</button>
        </div>
        <div style={{background:C.card,borderRadius:12,padding:'14px 16px',border:`1px solid ${C.border}`,marginBottom:10}}>
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:10}}>
            <span style={{fontSize:13,color:C.muted}}>Total por cobrar</span>
            <span style={{fontSize:16,fontWeight:700,color:C.overdue}}>{fmt(totalPorCobrar)}</span>
          </div>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:6}}>
            {[['0-30d',fmt(age0_30),C.normal],['31-60d',fmt(age31_60),C.soon],['60d+',fmt(age60p),C.overdue]].map(([l,v,col])=>(
              <div key={l} style={{textAlign:'center',padding:'6px 0',borderRadius:7,background:'#F7F7F7'}}>
                <div style={{fontSize:10,color:C.muted,marginBottom:2}}>{l}</div>
                <div style={{fontSize:11,fontWeight:700,color:col}}>{v}</div>
              </div>
            ))}
          </div>
        </div>
        {(()=>{
          const byClient = {}
          porCobrar.forEach(b=>{
            const cid = b.client_id||'__none__'
            const cname = clients.find(c=>c.id===cid)?.name||'Sin cliente'
            if(!byClient[cid]) byClient[cid]={name:cname,total:0,vencido:0,count:0}
            byClient[cid].total += (b.amount||0)
            byClient[cid].count += 1
            if(b.status==='Vencido') byClient[cid].vencido += (b.amount||0)
          })
          return Object.values(byClient)
            .sort((a,b)=>b.total-a.total)
            .slice(0,5)
            .map(c=>(
              <div key={c.name} style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'8px 0',borderBottom:`1px solid ${C.border}`}}>
                <div style={{minWidth:0,flex:1}}>
                  <div style={{fontSize:13,fontWeight:500,color:C.text,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{c.name}</div>
                  <div style={{fontSize:11,color:C.muted}}>{c.count} factura{c.count!==1?'s':''}{c.vencido>0?` · `+fmt(c.vencido)+' vencido':''}</div>
                </div>
                <div style={{textAlign:'right',flexShrink:0,marginLeft:12}}>
                  <div style={{fontSize:13,fontWeight:700,color:c.vencido>0?C.overdue:C.text}}>{fmt(c.total)}</div>
                </div>
              </div>
            ))
        })()}
      </div>

      {negatives.length>0&&(
        <div style={{padding:'16px 20px 0'}}>
          <div style={{background:'#FBE9E7',borderRadius:10,padding:'12px 14px',border:'1px solid #f5c6c2'}}>
            <div style={{fontSize:11,fontWeight:600,color:C.overdue,marginBottom:6}}>Fondos negativos</div>
            {negatives.map(c=>(
              <div key={c.id} style={{display:'flex',justifyContent:'space-between',fontSize:12,color:C.text,marginBottom:2}}>
                <span>{c.name}</span><span style={{fontWeight:600,color:C.overdue}}>{fmt(balances[c.id])}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <PorFacturarMes billing={billing} clients={clients}/>

      {tasks?.filter(t=>t.status==='Activo').length>0&&(
        <div style={{padding:'16px 20px 0'}}>
          <div style={{fontSize:11,fontWeight:600,color:C.muted,textTransform:'uppercase',letterSpacing:.5,marginBottom:8}}>Tareas por persona</div>
          <TasksByPerson tasks={tasks} clients={clients}/>
        </div>
      )}

      {/* Proyección de caja */}
      <CashflowProjection billing={billing}/>

      <div style={{height:20}}/>
    </div>
  )
}


// ─── SALES VIEW ───────────────────────────────────────────────────────────────
function SalesView({sales,clients,onEdit,onAdd}) {
  const [fYear,setFYear] = useState(String(currentYear))
  const [fArea,setFArea] = useState('')
  const [fStatus,setFStatus] = useState('Activo')
  const filtered = useMemo(()=>{
    let r = sales
    if(fYear) r = r.filter(s=>String(s.year)===fYear)
    if(fArea) r = r.filter(s=>s.area===fArea)
    if(fStatus) r = r.filter(s=>s.status===fStatus)
    return r.sort((a,b)=>new Date(b.created_at||0)-new Date(a.created_at||0))
  },[sales,fYear,fArea,fStatus])
  const totalUF = filtered.reduce((a,s)=>a+(parseFloat(s.amount_uf)||0),0)
  const totalCLP = filtered.reduce((a,s)=>{ const clp=s.amount_clp||(s.amount_uf&&s.uf_value?Math.round(s.amount_uf*s.uf_value):0); return a+clp },0)
  const years = [...new Set(sales.map(s=>s.year).filter(Boolean))].sort((a,b)=>b-a)
  if(!years.includes(currentYear)) years.unshift(currentYear)
  return (
    <div>
      <div style={{padding:'20px 20px 10px',position:'sticky',top:0,background:C.bg,zIndex:10}}>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:10}}>
          <div style={{fontSize:20,fontWeight:600,color:C.text,fontFamily:"'DM Sans',sans-serif",letterSpacing:-.4}}>Ventas</div>
          <button onClick={onAdd} style={{padding:'6px 14px',borderRadius:8,border:`1px solid ${C.accent}`,background:C.accent,color:'#fff',fontSize:12,fontWeight:600,cursor:'pointer'}}>+ Nueva</button>
        </div>
        <div style={{display:'flex',gap:6,marginBottom:8,flexWrap:'wrap'}}>
          <select value={fYear} onChange={e=>setFYear(e.target.value)} style={{flex:1,minWidth:70,padding:'7px 10px',borderRadius:8,border:`1px solid ${C.border}`,background:'#F7F7F7',color:C.text,fontSize:12}}>
            <option value=''>Todos</option>
            {years.map(y=><option key={y} value={y}>{y}</option>)}
          </select>
          <select value={fArea} onChange={e=>setFArea(e.target.value)} style={{flex:1,minWidth:100,padding:'7px 10px',borderRadius:8,border:`1px solid ${C.border}`,background:'#F7F7F7',color:C.text,fontSize:12}}>
            <option value=''>Todas las areas</option>
            {['Corporativo','Tributario','Laboral','Otro'].map(a=><option key={a} value={a}>{a}</option>)}
          </select>
          <select value={fStatus} onChange={e=>setFStatus(e.target.value)} style={{flex:1,minWidth:90,padding:'7px 10px',borderRadius:8,border:`1px solid ${C.border}`,background:'#F7F7F7',color:C.text,fontSize:12}}>
            <option value=''>Todos</option>
            {['Activo','Terminado','Pausado'].map(s=><option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        {filtered.length>0&&(
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8,marginBottom:4}}>
            <div style={{background:'#E3EEF3',borderRadius:9,padding:'8px 12px',border:`1px solid ${C.border}`}}>
              <div style={{fontSize:10,color:C.muted,marginBottom:2}}>TOTAL UF</div>
              <div style={{fontSize:13,fontWeight:700,color:C.accent}}>{fmtUF(totalUF)}</div>
            </div>
            <div style={{background:'#EEF3E3',borderRadius:9,padding:'8px 12px',border:`1px solid ${C.border}`}}>
              <div style={{fontSize:10,color:C.muted,marginBottom:2}}>TOTAL CLP</div>
              <div style={{fontSize:13,fontWeight:700,color:C.normal}}>{fmt(totalCLP)}</div>
            </div>
          </div>
        )}
      </div>
      <div style={{padding:'4px 20px 100px'}}>
        {filtered.length===0&&<div style={{color:C.muted,textAlign:'center',padding:40}}>Sin ventas en esta categoria</div>}
        {filtered.map(s=>{
          const clp=s.amount_clp||(s.amount_uf&&s.uf_value?Math.round(s.amount_uf*s.uf_value):0)
          const client=clients.find(c=>c.id===s.client_id)
          return (
            <div key={s.id} onClick={()=>onEdit(s)} style={{background:C.card,borderRadius:10,padding:'12px 14px',marginBottom:8,border:`1px solid ${C.border}`,cursor:'pointer'}}
              onMouseEnter={e=>e.currentTarget.style.borderColor=C.accent}
              onMouseLeave={e=>e.currentTarget.style.borderColor=C.border}>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',gap:8,marginBottom:5}}>
                <div style={{minWidth:0,flex:1}}>
                  <div style={{fontSize:13,fontWeight:600,color:C.text,marginBottom:2,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{s.title}</div>
                  <div style={{fontSize:11,color:C.muted}}>{client?.name||'—'}</div>
                </div>
                <div style={{textAlign:'right',flexShrink:0}}>
                  {s.amount_uf>0&&<div style={{fontSize:13,fontWeight:700,color:C.accent}}>{fmtUF(s.amount_uf)}</div>}
                  {clp>0&&<div style={{fontSize:11,color:C.muted}}>{fmt(clp)}</div>}
                </div>
              </div>
              <div style={{display:'flex',gap:6,alignItems:'center',flexWrap:'wrap'}}>
                <AreaChip area={s.area}/>
                <span style={{fontSize:10,color:C.muted}}>{s.year}{s.month?' · '+String(s.month).padStart(2,'0'):''}</span>
                <Pill label={s.status} bg={s.status==='Activo'?C.accent:s.status==='Terminado'?C.done:'#C77F18'} small/>
              </div>
              {s.notes&&<div style={{fontSize:11,color:C.muted,marginTop:5,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{s.notes}</div>}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function MiniClientForm({onSave,onCancel}) {
  const [f,setF] = useState({name:'',rut:'',type:'Corporativo'})
  const [saving,setSaving] = useState(false)
  const up=(k,v)=>setF(p=>({...p,[k]:v}))
  const save = async() => {
    if(!f.name.trim()) return
    setSaving(true)
    try {
      const {data,error} = await supabase.from('clients').insert({...f,status:'Activo'}).select().single()
      if(error) throw error
      onSave(data)
    } catch(e) { alert('Error: '+e.message) }
    setSaving(false)
  }
  return (
    <div style={{background:'#F0F5F7',borderRadius:10,padding:'12px 14px',marginBottom:12,border:`1px solid ${C.accent}`}}>
      <div style={{fontSize:12,fontWeight:600,color:C.accent,marginBottom:10}}>Nuevo cliente</div>
      <Fld label='Nombre'><Inp value={f.name} onChange={e=>up('name',e.target.value)} placeholder='Nombre del cliente...' autoFocus/></Fld>
      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8}}>
        <Fld label='RUT'><Inp value={f.rut} onChange={e=>up('rut',e.target.value)} placeholder='76.xxx.xxx-x'/></Fld>
        <Fld label='Tipo'><Sel value={f.type} onChange={e=>up('type',e.target.value)} options={['Corporativo','Tributario','Laboral','Otro']}/></Fld>
      </div>
      <div style={{display:'flex',gap:8,marginTop:4}}>
        <button onClick={onCancel} style={{flex:1,padding:8,borderRadius:8,border:`1px solid ${C.border}`,background:'transparent',color:C.muted,fontSize:12,cursor:'pointer'}}>Cancelar</button>
        <button disabled={saving||!f.name.trim()} onClick={save} style={{flex:2,padding:8,borderRadius:8,border:'none',background:C.accent,color:'#fff',fontSize:12,fontWeight:600,cursor:'pointer'}}>{saving?'Guardando...':'Crear cliente'}</button>
      </div>
    </div>
  )
}

function SaleForm({sale,clients:initialClients,clientEntities,onSave,onClose,onDelete,saving}) {
  const MONTHS = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre']
  const WHO_LIST = ['Cristóbal','Erasmo','Martín','Martina','Rodrigo']
  const [f,setF] = useState(sale||{client_id:'',title:'',area:'Corporativo',amount_uf:'',cost_uf:'',uf_value:'',year:currentYear,month:currentMonth,status:'Activo',notes:'',responsible:'',cobro_type:'cuotas',entity_id:''})
  const [clients,setClients] = useState(initialClients)
  const [clientQ,setClientQ] = useState('')
  const [showNewClient,setShowNewClient] = useState(false)
  const [selectedClient,setSelectedClient] = useState(initialClients.find(c=>c.id===sale?.client_id)||null)
  // Forma de cobro
  const [cobroType,setCobroType] = useState(sale?.cobro_type||'cuotas')
  const [nCuotas,setNCuotas] = useState(sale?.cobro_config?.nCuotas||3)
  const [cobroInicio,setCobroInicio] = useState(sale?.cobro_config?.cobroInicio||'')
  const [tramos,setTramos] = useState(sale?.cobro_config?.tramos||[{id:1,pct:50,fecha:''},{id:2,pct:50,fecha:''}])
  const [cuotasCustom,setCuotasCustom] = useState(sale?.cobro_config?.cuotasCustom||[{id:1,monto:'',fecha:''}])
  const [mensualInicio,setMensualInicio] = useState(sale?.cobro_config?.mensualInicio||'')

  const up=(k,v)=>setF(p=>({...p,[k]:v}))
  const clientMatches = useMemo(()=>{ if(!clientQ.trim()) return []; return clients.filter(c=>c.name.toLowerCase().includes(clientQ.toLowerCase())).slice(0,6) },[clients,clientQ])
  const clientEntitiesList = useMemo(()=>{ if(!f.client_id) return []; return (clientEntities||[]).filter(e=>e.client_id===f.client_id) },[clientEntities,f.client_id])
  const moneda = f.moneda||'UF'
  const ufVal = parseFloat(f.uf_value)||0
  const amountUF = parseFloat(f.amount_uf)||0
  const montoCLP = parseFloat(f.amount_clp)||0
  const totalCLP = moneda==='CLP' ? montoCLP : amountUF*ufVal

  // Generar cobros desde forma de cobro
  const generarCobros = () => {
    if(!f.client_id||!totalCLP) return []
    const cobros = []
    if(cobroType==='mensual' && mensualInicio) {
      const [y,m] = mensualInicio.split('-').map(Number)
      let cy=y, cm=m
      for(let i=0;i<12;i++){
        const fecha=`${cy}-${String(cm).padStart(2,'0')}-01`
        cobros.push({monto:Math.round(totalCLP), fecha, label:`Mensual ${MONTHS[cm-1]} ${cy}`})
        cm++; if(cm>12){cm=1;cy++}
      }
    } else if(cobroType==='cuotas' && cobroInicio && nCuotas>0) {
      const montoCuota = Math.round(totalCLP/nCuotas)
      for(let i=0;i<nCuotas;i++) {
        const d = new Date(cobroInicio+'T12:00')
        d.setMonth(d.getMonth()+i)
        cobros.push({monto:montoCuota, fecha:d.toISOString().slice(0,10), label:`Cuota ${i+1}/${nCuotas}`})
      }
    } else if(cobroType==='porcentaje') {
      tramos.forEach(t=>{ if(t.pct&&t.fecha) cobros.push({monto:Math.round(totalCLP*t.pct/100), fecha:t.fecha, label:`${t.pct}%`}) })
    } else if(cobroType==='personalizada') {
      cuotasCustom.forEach((c,i)=>{ if(c.monto&&c.fecha){ const mm = moneda==='CLP' ? Math.round(parseFloat(c.monto)||0) : Math.round((parseFloat(c.monto)||0)*ufVal); cobros.push({monto:mm, fecha:c.fecha, label: moneda==='CLP'?`Cobro ${i+1}`:`Cobro ${i+1} (${c.monto} UF)`}) } })
    }
    return cobros
  }
  const cobros = generarCobros()

  const handleSave = () => {
    onSave({...f, cobros, cobro_type:cobroType, cobro_config:{nCuotas,cobroInicio,tramos,cuotasCustom,mensualInicio}})
  }

  return (
    <>
      {/* Selector de cliente con búsqueda */}
      {!selectedClient ? (
        <Fld label='Cliente'>
          <div style={{position:'relative'}}>
            <div style={{display:'flex',gap:6}}>
              <Inp value={clientQ} onChange={e=>setClientQ(e.target.value)} placeholder='Buscar cliente...' autoFocus style={{flex:1}}/>
              <button onClick={()=>setShowNewClient(true)} style={{padding:'8px 12px',borderRadius:8,border:`1px solid ${C.accent}`,background:'transparent',color:C.accent,fontSize:12,fontWeight:600,cursor:'pointer',flexShrink:0}}>+ Nuevo</button>
            </div>
            {clientMatches.length>0&&(
              <div style={{position:'absolute',top:'100%',left:0,right:0,background:'#fff',border:`1px solid ${C.border}`,borderRadius:8,boxShadow:'0 4px 20px rgba(0,0,0,.12)',zIndex:100,marginTop:4,maxHeight:200,overflowY:'auto'}}>
                {clientMatches.map(c=>(
                  <div key={c.id} onMouseDown={()=>{setSelectedClient(c);up('client_id',c.id);setClientQ('')}}
                    style={{padding:'9px 14px',cursor:'pointer',borderBottom:`1px solid ${C.border}`,fontSize:13}}
                    onMouseEnter={e=>e.currentTarget.style.background='#F0F4F6'}
                    onMouseLeave={e=>e.currentTarget.style.background='#fff'}>
                    <div style={{fontWeight:500}}>{c.name}</div>
                    {c.rut&&<div style={{fontSize:11,color:C.muted}}>{c.rut}</div>}
                  </div>
                ))}
              </div>
            )}
          </div>
        </Fld>
      ) : (
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:14,padding:'10px 14px',borderRadius:8,background:'#E6EEF1',border:`1px solid ${C.accent}`}}>
          <div>
            <div style={{fontSize:13,fontWeight:600,color:C.accent}}>{selectedClient.name}</div>
            {selectedClient.rut&&<div style={{fontSize:11,color:C.muted}}>{selectedClient.rut}</div>}
          </div>
          <button onClick={()=>{setSelectedClient(null);up('client_id','')}} style={{background:'none',border:'none',color:C.muted,fontSize:13,cursor:'pointer'}}>Cambiar</button>
        </div>
      )}

      {showNewClient&&<MiniClientForm onSave={c=>{setClients(p=>[...p,c]);setSelectedClient(c);up('client_id',c.id);setShowNewClient(false)}} onCancel={()=>setShowNewClient(false)}/>}

      <Fld label='Proyecto'><Inp value={f.title||''} onChange={e=>up('title',e.target.value)} placeholder='Ej: Reorganizacion societaria...'/></Fld>

      {f.client_id&&(
        <Fld label='Razón social a facturar'>
          {clientEntitiesList.length>0?(
            <select value={f.entity_id||''} onChange={e=>up('entity_id',e.target.value)} style={{width:'100%',padding:'10px 12px',borderRadius:8,border:`1px solid ${C.border}`,background:'#F7F7F7',color:C.text,fontSize:14,boxSizing:'border-box'}}>
              <option value=''>— Asociar después —</option>
              {clientEntitiesList.map(e=><option key={e.id} value={e.id}>{e.name}{e.rut?` · ${e.rut}`:''}</option>)}
            </select>
          ):(
            <div style={{fontSize:12,color:C.muted,padding:'8px 0'}}>Este cliente no tiene razones sociales registradas. Se asociará al emitir la primera factura.</div>
          )}
        </Fld>
      )}

      <div style={{marginBottom:10}}>
        <Lbl>Moneda</Lbl>
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:6}}>
          {[['UF','UF'],['CLP','Pesos (CLP)']].map(([v,l])=>(
            <button key={v} type='button' onClick={()=>up('moneda',v)} style={{padding:'8px',borderRadius:8,border:`2px solid ${moneda===v?C.accent:C.border}`,background:moneda===v?'#E6EEF1':'transparent',color:moneda===v?C.accent:C.muted,fontSize:12,fontWeight:700,cursor:'pointer'}}>{l}</button>
          ))}
        </div>
      </div>
      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10}}>
        <Fld label='Área'><Sel value={f.area||'Corporativo'} onChange={e=>up('area',e.target.value)} options={['Corporativo','Tributario','Laboral','Otro']}/></Fld>
        <Fld label='Responsable'>
          <select value={f.responsible||''} onChange={e=>up('responsible',e.target.value)} style={{width:'100%',padding:'10px 12px',borderRadius:8,border:`1px solid ${C.border}`,background:'#F7F7F7',color:C.text,fontSize:14,boxSizing:'border-box'}}>
            <option value=''>— Seleccionar —</option>
            {WHO_LIST.map(w=><option key={w} value={w}>{w}</option>)}
          </select>
        </Fld>
        {moneda==='UF'?<>
        <Fld label='Honorarios UF'><Inp type='number' step='0.01' value={f.amount_uf||''} onChange={e=>up('amount_uf',e.target.value)} placeholder='0.00'/></Fld>
        <Fld label='Costo UF (terceros)'><Inp type='number' step='0.01' value={f.cost_uf||''} onChange={e=>up('cost_uf',e.target.value)} placeholder='0.00'/></Fld>
        <Fld label='Valor UF (CLP)'><Inp type='number' value={f.uf_value||''} onChange={e=>up('uf_value',e.target.value)} placeholder='Ej: 38500'/></Fld>
        </>:<>
        <Fld label='Monto total (CLP)'><Inp type='number' value={f.amount_clp||''} onChange={e=>up('amount_clp',e.target.value)} placeholder='Ej: 1500000'/></Fld>
        </>}
        <Fld label='Estado'><Sel value={f.status||'Activo'} onChange={e=>up('status',e.target.value)} options={['Activo','Terminado','Pausado']}/></Fld>
        <Fld label='Año presupuesto'><Inp type='number' value={f.year||currentYear} onChange={e=>up('year',parseInt(e.target.value))} placeholder={String(currentYear)}/></Fld>
        <Fld label='Mes'>
          <select value={f.month||currentMonth} onChange={e=>up('month',parseInt(e.target.value))} style={{width:'100%',padding:'10px 12px',borderRadius:8,border:`1px solid ${C.border}`,background:'#F7F7F7',color:C.text,fontSize:14,boxSizing:'border-box'}}>
            {MONTHS.map((m,i)=><option key={i+1} value={i+1}>{m}</option>)}
          </select>
        </Fld>
      </div>

      {/* Forma de cobro */}
      {totalCLP>0&&(
        <div style={{marginTop:4,marginBottom:12}}>
          <Lbl>Forma de cobro</Lbl>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:6,marginBottom:12}}>
            {[['cuotas','Cuotas mensuales'],['mensual','Mensual recurrente'],['porcentaje','Por porcentaje'],['personalizada','Personalizada']].map(([v,l])=>(
              <button key={v} onClick={()=>setCobroType(v)} style={{padding:'8px 4px',borderRadius:8,border:`2px solid ${cobroType===v?C.accent:C.border}`,background:cobroType===v?'#E6EEF1':'transparent',color:cobroType===v?C.accent:C.muted,fontSize:10,fontWeight:700,cursor:'pointer',textAlign:'center'}}>{l}</button>
            ))}
          </div>

          {cobroType==='mensual'&&(
            <div style={{background:'#F7F7F7',borderRadius:8,padding:'12px 14px'}}>
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10,marginBottom:8}}>
                {moneda==='UF'
                  ? <Fld label='Monto mensual UF'><Inp type='number' step='0.01' value={f.amount_uf||''} onChange={e=>up('amount_uf',e.target.value)} placeholder='0.00'/></Fld>
                  : <Fld label='Monto mensual (CLP)'><Inp type='number' value={f.amount_clp||''} onChange={e=>up('amount_clp',e.target.value)} placeholder='Ej: 1500000'/></Fld>}
                <Fld label='Inicio cobro'><Inp type='date' value={mensualInicio} onChange={e=>setMensualInicio(e.target.value)}/></Fld>
              </div>
              {mensualInicio&&totalCLP>0&&<div style={{fontSize:11,color:C.muted}}>Genera <strong style={{color:C.text}}>12 cobros</strong> de <strong style={{color:C.text}}>{fmt(Math.round(totalCLP))}</strong>/mes desde {mensualInicio.slice(0,7)}</div>}
            </div>
          )}

          {cobroType==='cuotas'&&(
            <div style={{background:'#F7F7F7',borderRadius:8,padding:'12px 14px'}}>
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10,marginBottom:8}}>
                <Fld label='N° cuotas'><Inp type='number' min='1' max='36' value={nCuotas} onChange={e=>setNCuotas(Math.max(1,parseInt(e.target.value)||1))}/></Fld>
                <Fld label='Inicio cobro'><Inp type='date' value={cobroInicio} onChange={e=>setCobroInicio(e.target.value)}/></Fld>
              </div>
              {cobroInicio&&<div style={{fontSize:11,color:C.muted}}>Cuota mensual: <strong style={{color:C.text}}>{fmt(Math.round(totalCLP/nCuotas))}</strong> · Total: {fmt(totalCLP)}</div>}
            </div>
          )}

          {cobroType==='porcentaje'&&(
            <div style={{background:'#F7F7F7',borderRadius:8,padding:'12px 14px'}}>
              {tramos.map((t,i)=>(
                <div key={t.id} style={{display:'grid',gridTemplateColumns:'60px 1fr 32px',gap:8,marginBottom:8,alignItems:'flex-end'}}>
                  <Fld label={i===0?'%':''}><Inp type='number' min='0' max='100' value={t.pct} onChange={e=>setTramos(p=>p.map(x=>x.id===t.id?{...x,pct:parseInt(e.target.value)||0}:x))}/></Fld>
                  <Fld label={i===0?'Fecha':''}><Inp type='date' value={t.fecha} onChange={e=>setTramos(p=>p.map(x=>x.id===t.id?{...x,fecha:e.target.value}:x))}/></Fld>
                  {tramos.length>2&&<button onClick={()=>setTramos(p=>p.filter(x=>x.id!==t.id))} style={{background:'none',border:'none',color:C.muted,cursor:'pointer',fontSize:18,paddingBottom:2}}>×</button>}
                </div>
              ))}
              <button onClick={()=>setTramos(p=>[...p,{id:Date.now(),pct:0,fecha:''}])} style={{fontSize:12,color:C.accent,background:'none',border:'none',cursor:'pointer',fontWeight:600}}>+ Agregar tramo</button>
              <div style={{fontSize:11,color:tramos.reduce((a,t)=>a+t.pct,0)!==100?C.overdue:C.normal,marginTop:4}}>Total: {tramos.reduce((a,t)=>a+t.pct,0)}% {tramos.reduce((a,t)=>a+t.pct,0)!==100?'(debe sumar 100%)':''}</div>
            </div>
          )}

          {cobroType==='personalizada'&&(
            <div style={{background:'#F7F7F7',borderRadius:8,padding:'12px 14px'}}>
              {cuotasCustom.map((c,i)=>(
                <div key={c.id} style={{display:'grid',gridTemplateColumns:'1fr 1fr 32px',gap:8,marginBottom:8,alignItems:'flex-end'}}>
                  <Fld label={i===0?'Monto UF':''}><Inp type='number' step='0.01' value={c.monto} onChange={e=>setCuotasCustom(p=>p.map(x=>x.id===c.id?{...x,monto:e.target.value}:x))} placeholder='0.00'/></Fld>
                  <Fld label={i===0?'Fecha':''}>
                    <div>
                      <Inp type='date' value={c.fecha} onChange={e=>setCuotasCustom(p=>p.map(x=>x.id===c.id?{...x,fecha:e.target.value}:x))}/>
                      {c.monto&&ufVal>0&&<div style={{fontSize:10,color:C.muted,marginTop:2}}>{fmt(Math.round(parseFloat(c.monto)*ufVal))}</div>}
                    </div>
                  </Fld>
                  {cuotasCustom.length>1&&<button onClick={()=>setCuotasCustom(p=>p.filter(x=>x.id!==c.id))} style={{background:'none',border:'none',color:C.muted,cursor:'pointer',fontSize:18,paddingBottom:2}}>×</button>}
                </div>
              ))}
              <button onClick={()=>setCuotasCustom(p=>[...p,{id:Date.now(),monto:'',fecha:''}])} style={{fontSize:12,color:C.accent,background:'none',border:'none',cursor:'pointer',fontWeight:600}}>+ Agregar cuota</button>
              {cuotasCustom.some(c=>c.monto)&&<div style={{fontSize:11,color:C.muted,marginTop:6}}>Total: <strong style={{color:C.text}}>{fmtUF(cuotasCustom.reduce((a,c)=>a+(parseFloat(c.monto)||0),0))}</strong> = {fmt(Math.round(cuotasCustom.reduce((a,c)=>a+(parseFloat(c.monto)||0),0)*ufVal))}</div>}
            </div>
          )}

          {cobros.length>0&&(
            <div style={{marginTop:8,padding:'8px 12px',borderRadius:8,background:'#E6EEF1',fontSize:11,color:C.accent}}>
              Se crearán <strong>{cobros.length} cobro{cobros.length!==1?'s':''}</strong> pendientes: {cobros.map(c=>`${c.label} ${fmt(c.monto)} (${c.fecha})`).join(' · ')}
            </div>
          )}
        </div>
      )}

      {Number(f.monto_terceros)>0 && <div style={{fontSize:11,color:C.accent,marginTop:-4,marginBottom:8}}>Neto firma: {fmt((Number(f.amount)||0)-(Number(f.monto_terceros)||0))} · Terceros: {fmt(Number(f.monto_terceros)||0)}</div>}
      <Fld label='Notas'><Txt value={f.notes||''} onChange={e=>up('notes',e.target.value)} placeholder='Observaciones...'/></Fld>
      <div style={{display:'flex',gap:8,marginTop:4}}>
        {sale?.id&&<button onClick={()=>onDelete(sale.id)} style={{padding:'11px 14px',borderRadius:10,border:`1px solid ${C.overdue}`,background:'transparent',color:C.overdue,fontSize:13,fontWeight:600,cursor:'pointer'}}>Eliminar</button>}
        <button onClick={onClose} style={{flex:1,padding:11,borderRadius:10,border:`1px solid ${C.border}`,background:'transparent',color:C.muted,fontSize:13,fontWeight:600,cursor:'pointer'}}>Cancelar</button>
        <button disabled={saving||!f.client_id||!f.title} onClick={handleSave} style={{flex:2,padding:11,borderRadius:10,border:'none',background:C.accent,color:'#fff',fontSize:13,fontWeight:700,cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center',gap:8,opacity:(!f.client_id||!f.title)?.6:1}}>
          {saving?<Spin/>:null}{saving?'Guardando...':'Guardar'}
        </button>
      </div>
    </>
  )
}
function AsignarClienteInline({bill,clients,onAssign}) {
  const [open,setOpen] = useState(false)
  const [q,setQ] = useState('')
  const matches = useMemo(()=>{ if(!q.trim()) return []; return clients.filter(c=>c.name.toLowerCase().includes(q.toLowerCase())).sort((a,b)=>a.name.localeCompare(b.name,'es')).slice(0,6) },[q,clients])
  if(!open) return (
    <button onClick={()=>setOpen(true)} style={{padding:'3px 9px',borderRadius:6,border:`1px solid ${C.accent}`,background:'transparent',color:C.accent,fontSize:11,fontWeight:600,cursor:'pointer',whiteSpace:'nowrap'}}>Asignar cliente</button>
  )
  return (
    <div style={{position:'relative',minWidth:180}}>
      <input autoFocus value={q} onChange={e=>setQ(e.target.value)} onBlur={()=>setTimeout(()=>setOpen(false),150)} placeholder='Buscar cliente...' style={{width:'100%',padding:'6px 10px',borderRadius:6,border:`1px solid ${C.border}`,background:'#F7F7F7',color:C.text,fontSize:12,boxSizing:'border-box',outline:'none'}}/>
      {matches.length>0&&(
        <div style={{position:'absolute',top:'100%',right:0,left:0,background:'#fff',border:`1px solid ${C.border}`,borderRadius:8,boxShadow:'0 4px 16px rgba(0,0,0,.12)',zIndex:100,marginTop:4,maxHeight:200,overflowY:'auto'}}>
          {matches.map(c=>(
            <div key={c.id} onMouseDown={()=>{onAssign(bill,c.id);setOpen(false);setQ('')}} style={{padding:'8px 12px',cursor:'pointer',borderBottom:`1px solid ${C.border}`,fontSize:12}} onMouseEnter={e=>e.currentTarget.style.background='#F0F4F6'} onMouseLeave={e=>e.currentTarget.style.background='#fff'}>
              <div style={{fontWeight:500}}>{c.name}</div>
              {c.rut&&<div style={{fontSize:10,color:C.muted}}>{c.rut}</div>}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function BillingView({billing,clients,sales,hideErasmo,onStatusChange,onDelete,onAdd,onEdit,onImport,onUpload,onAssignClient}) {
  const [filter,setFilter] = useState('emitidas')
  const [fYear,setFYear] = useState('')
  const [fMonth,setFMonth] = useState('')
  const [q,setQ] = useState('')
  const [payingId,setPayingId] = useState(null)
  const [payDate,setPayDate] = useState('')
  const [openClients,setOpenClients] = useState(()=>new Set())
  const toggleClient = id => setOpenClients(prev=>{const n=new Set(prev); n.has(id)?n.delete(id):n.add(id); return n})
  const collapseAll = () => setOpenClients(new Set())
  const [selected,setSelected] = useState(()=>new Set())
  const toggleSel = id => setSelected(prev=>{const n=new Set(prev); n.has(id)?n.delete(id):n.add(id); return n})
  const clearSel = () => setSelected(new Set())
  const MONTHS = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic']

  const bb = hideErasmo ? billing.filter(b=>!b.erasmo) : billing
  const isProg = filter==='programadas'
  // En Programadas la fecha relevante es el vencimiento (due); en el resto, la emisión (issued_at)
  const dateField = b => isProg ? b.due : b.issued_at
  const filtered = useMemo(()=>{
    let r = bb
    if(filter==='emitidas') r = r.filter(b=>['Pendiente','Vencido','Propuesta'].includes(b.status))
    else if(filter==='programadas') r = r.filter(b=>b.status==='Programada')
    else if(filter==='pagado') r = r.filter(b=>b.status==='Pagado')
    if(fYear) r = r.filter(b=>dateField(b)?.startsWith(fYear))
    if(fMonth) r = r.filter(b=>dateField(b)?.slice(5,7)===fMonth)
    if(q.trim()) r = r.filter(b=>{
      const c=clients.find(x=>x.id===b.client_id)
      return c?.name.toLowerCase().includes(q.toLowerCase())||b.concept?.toLowerCase().includes(q.toLowerCase())||b.invoice_no?.toLowerCase().includes(q.toLowerCase())||b.receptor_name?.toLowerCase().includes(q.toLowerCase())
    })
    return r.sort((a,b)=> isProg
      ? new Date(a.due||0)-new Date(b.due||0)
      : new Date(b.issued_at||0)-new Date(a.issued_at||0))
  },[bb,filter,fYear,fMonth,q,clients,isProg])

  // Agrupar por cliente → razón social
  const grouped = useMemo(()=>{
    const byClient = {}
    filtered.forEach(b=>{
      const cid = b.client_id||'__none__'
      if(!byClient[cid]) byClient[cid] = {client:clients.find(c=>c.id===cid)||{id:'__none__',name:'Sin cliente'}, byEntity:{}}
      const ename = b.receptor_name||'—'
      if(!byClient[cid].byEntity[ename]) byClient[cid].byEntity[ename] = []
      byClient[cid].byEntity[ename].push(b)
    })
    return Object.values(byClient).sort((a,b)=>a.client.name.localeCompare(b.client.name,'es'))
  },[filtered,clients])

  const pending=bb.filter(b=>b.status==='Pendiente').reduce((s,b)=>s+(b.amount||0),0)
  const overdue=bb.filter(b=>b.status==='Vencido').reduce((s,b)=>s+(b.amount||0),0)
  const paid=bb.filter(b=>b.status==='Pagado').reduce((s,b)=>s+(b.amount||0),0)
  const programado=bb.filter(b=>b.status==='Programada').reduce((s,b)=>s+(b.amount||0),0)
  // Contadores por nº de documentos para las tabs
  const nEmitidas=bb.filter(b=>['Pendiente','Vencido','Propuesta'].includes(b.status)).length
  const nProgramadas=bb.filter(b=>b.status==='Programada').length
  const nPagadas=bb.filter(b=>b.status==='Pagado').length
  const years=[...new Set(bb.map(b=>b.issued_at?.slice(0,4)).filter(Boolean))].sort((a,b)=>b-a)

  const handleTogglePagado = async(b) => {
    if(b.status==='Pagado') { await onStatusChange(b.id,'Pendiente',null) }
    else { setPayingId(b.id); setPayDate(new Date().toISOString().slice(0,10)) }
  }
  const confirmPago = async() => { await onStatusChange(payingId,'Pagado',payDate); setPayingId(null) }
  const marcarEmitida = async(b) => { if(confirm('¿Confirmas que la factura ya se emitió? Se quitará de programadas.')) await onDelete(b.id) }
  const marcarEmitidasBulk = async() => { const ids=[...selected]; if(ids.length&&confirm(`¿Marcar ${ids.length} factura(s) como emitidas? Se quitarán de programadas.`)){ await onDelete(ids); clearSel() } }

  const [descargando,setDescargando] = useState(false)
  const descargarProgramadas = async() => {
    if(filtered.length===0){ alert('No hay programadas en el filtro actual.'); return }
    setDescargando(true)
    try{
      // UF del día (mindicador.cl). Si falla, seguimos sin "Monto hoy".
      let ufHoy = null
      try{
        const r = await fetch('https://mindicador.cl/api/uf')
        const j = await r.json()
        ufHoy = j?.serie?.[0]?.valor || null
      }catch(_){}
      const XLSX = await import('https://cdn.sheetjs.com/xlsx-0.20.1/package/xlsx.mjs')
      const header = ['Cliente','Razón social','Proyecto','UF','Monto guardado ($)', ufHoy?`Monto hoy ($) · UF ${Math.round(ufHoy).toLocaleString('es-CL')}`:'Monto hoy ($)','Vencimiento']
      const rows = filtered.map(b=>{
        const c = clients.find(x=>x.id===b.client_id)
        const venta = (sales||[]).find(v=>v.id===b.sale_id)
        const esCLP = venta?.moneda==='CLP'
        const ufVal = venta?.uf_value || null
        const ufEq = (!esCLP && ufVal) ? (b.amount/ufVal) : null
        const montoHoy = esCLP ? (b.amount||0) : ((ufEq && ufHoy) ? Math.round(ufEq*ufHoy) : null)
        return [
          c?.name || 'Sin cliente',
          b.receptor_name || '',
          venta?.title || b.concept || '',
          esCLP ? '—' : (ufEq ? Number(ufEq.toFixed(2)) : ''),
          b.amount || 0,
          montoHoy ?? '',
          b.due || '',
        ]
      })
      // Fila de totales
      const totalGuardado = rows.reduce((a,r)=>a+(Number(r[4])||0),0)
      const totalHoy = rows.reduce((a,r)=>a+(Number(r[5])||0),0)
      rows.push([])
      rows.push(['','','TOTAL','', totalGuardado, totalHoy||'', ''])
      const ws = XLSX.utils.aoa_to_sheet([header, ...rows])
      ws['!cols'] = [{wch:24},{wch:26},{wch:30},{wch:10},{wch:16},{wch:18},{wch:14}]
      const wb = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(wb, ws, 'Programadas')
      const mesLbl = fMonth ? `_${MONTHS[parseInt(fMonth)-1]}` : ''
      const anioLbl = fYear ? `_${fYear}` : ''
      XLSX.writeFile(wb, `Programadas${mesLbl}${anioLbl}_${new Date().toISOString().slice(0,10)}.xlsx`)
    }catch(e){ alert('Error al generar Excel: '+e.message) }
    setDescargando(false)
  }

  return (
    <div>
      <div style={{padding:'20px 20px 0',position:'sticky',top:0,background:C.bg,zIndex:10}}>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:10}}>
          <div style={{fontSize:20,fontWeight:600,color:C.text,fontFamily:"'DM Sans',sans-serif",letterSpacing:-.4}}>Facturación</div>
          <div style={{display:'flex',gap:6}}>
            {isProg&&<button onClick={descargarProgramadas} disabled={descargando} style={{padding:'6px 12px',borderRadius:8,border:`1px solid ${C.accent}`,background:'#fff',color:C.accent,fontSize:12,fontWeight:600,cursor:descargando?'default':'pointer',opacity:descargando?.6:1}}>{descargando?'Generando...':'↓ Programadas'}</button>}
            <button onClick={onUpload} style={{padding:'6px 12px',borderRadius:8,border:`1px solid ${C.border}`,background:'#fff',color:C.accent,fontSize:12,fontWeight:600,cursor:'pointer'}}>↑ PDFs</button>
            <button onClick={onImport} style={{padding:'6px 12px',borderRadius:8,border:`1px solid ${C.border}`,background:'#fff',color:C.accent,fontSize:12,fontWeight:600,cursor:'pointer'}}>Drive</button>
            <button onClick={onAdd} style={{padding:'6px 12px',borderRadius:8,border:`1px solid ${C.accent}`,background:C.accent,color:'#fff',fontSize:12,fontWeight:600,cursor:'pointer'}}>+ Nuevo</button>
          </div>
        </div>
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr 1fr',gap:8,marginBottom:10}}>
          {[['Por cobrar',fmt(pending),'#E3EEF3',C.accent],['Programado',fmt(programado),'#EEEAF3','#5B4B8A'],['Vencido',fmt(overdue),'#FBE9E7',C.overdue],['Cobrado',fmt(paid),'#E4F1EA',C.normal]].map(([l,v,bg,col])=>(
            <div key={l} style={{background:bg,borderRadius:10,padding:'10px 12px',border:`1px solid ${C.border}`}}>
              <div style={{fontSize:10,color:C.muted,marginBottom:3,textTransform:'uppercase',letterSpacing:.4}}>{l}</div>
              <div style={{fontSize:13,fontWeight:700,color:col}}>{v}</div>
            </div>
          ))}
        </div>
        <div style={{display:'flex',gap:6,marginBottom:8}}>
          {[['emitidas',`Emitidas (${nEmitidas})`],['programadas',`Programadas (${nProgramadas})`],['pagado',`Pagadas (${nPagadas})`],['all','Todas']].map(([v,l])=>(
            <button key={v} onClick={()=>{setFilter(v);clearSel()}} style={{flex:1,padding:'7px 2px',borderRadius:8,border:`1px solid ${filter===v?C.accent:C.border}`,background:filter===v?'#E6EEF1':'transparent',color:filter===v?C.accent:C.muted,fontSize:11,fontWeight:600,cursor:'pointer',whiteSpace:'nowrap'}}>{l}</button>
          ))}
        </div>
        <Inp value={q} onChange={e=>setQ(e.target.value)} placeholder='Buscar cliente, razón social, N° factura...' style={{marginBottom:6}}/>
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:6,marginBottom:4}}>
          <select value={fYear} onChange={e=>setFYear(e.target.value)} style={{padding:'7px 10px',borderRadius:8,border:`1px solid ${C.border}`,background:'#F7F7F7',color:C.text,fontSize:12}}>
            <option value=''>Todos los años</option>
            {years.map(y=><option key={y} value={y}>{y}</option>)}
          </select>
          <select value={fMonth} onChange={e=>setFMonth(e.target.value)} style={{padding:'7px 10px',borderRadius:8,border:`1px solid ${C.border}`,background:'#F7F7F7',color:C.text,fontSize:12}}>
            <option value=''>Todos los meses</option>
            {MONTHS.map((m,i)=><option key={i+1} value={String(i+1).padStart(2,'0')}>{m}</option>)}
          </select>
        </div>
        {(openClients.size>0||(isProg&&selected.size>0))&&(
          <div style={{display:'flex',justifyContent:'flex-end',gap:8,marginTop:6}}>
            {isProg&&selected.size>0&&(
              <button onClick={marcarEmitidasBulk} style={{padding:'4px 12px',borderRadius:8,border:`1px solid ${C.overdue}`,background:C.overdue,color:'#fff',fontSize:11,fontWeight:700,cursor:'pointer'}}>Marcar {selected.size} emitida{selected.size!==1?'s':''}</button>
            )}
            {isProg&&selected.size>0&&(
              <button onClick={clearSel} style={{padding:'4px 10px',borderRadius:8,border:`1px solid ${C.border}`,background:'transparent',color:C.muted,fontSize:11,fontWeight:600,cursor:'pointer'}}>Deseleccionar</button>
            )}
            {openClients.size>0&&(
              <button onClick={collapseAll} style={{padding:'4px 10px',borderRadius:8,border:`1px solid ${C.border}`,background:'transparent',color:C.muted,fontSize:11,fontWeight:600,cursor:'pointer'}}>Colapsar todo</button>
            )}
          </div>
        )}
      </div>

      {payingId&&(
        <div style={{position:'fixed',inset:0,background:'rgba(20,30,35,.45)',zIndex:300,display:'flex',alignItems:'flex-end',justifyContent:'center',padding:16}}>
          <div style={{background:'#fff',borderRadius:16,width:'100%',maxWidth:520,padding:20,boxShadow:'0 20px 60px rgba(0,0,0,.2)'}}>
            <div style={{fontSize:15,fontWeight:600,color:C.text,marginBottom:4}}>Confirmar pago</div>
            <div style={{fontSize:13,color:C.muted,marginBottom:14}}>Fecha en que se recibió el pago:</div>
            <input type='date' value={payDate} onChange={e=>setPayDate(e.target.value)} style={{width:'100%',padding:'10px 12px',borderRadius:8,border:`1px solid ${C.border}`,background:'#F7F7F7',color:C.text,fontSize:14,boxSizing:'border-box',marginBottom:14}}/>
            <div style={{display:'flex',gap:8}}>
              <button onClick={()=>setPayingId(null)} style={{flex:1,padding:11,borderRadius:10,border:`1px solid ${C.border}`,background:'transparent',color:C.muted,fontSize:13,fontWeight:600,cursor:'pointer'}}>Cancelar</button>
              <button onClick={confirmPago} style={{flex:2,padding:11,borderRadius:10,border:'none',background:C.normal,color:'#fff',fontSize:13,fontWeight:700,cursor:'pointer'}}>Confirmar pagado</button>
            </div>
          </div>
        </div>
      )}

      <div style={{padding:'10px 20px 100px'}}>
        {filtered.length===0&&<div style={{color:C.muted,textAlign:'center',padding:40}}>{isProg?'Sin facturas programadas':'Sin cobros'}</div>}
        {grouped.map(({client,byEntity})=>{
          const allBills = Object.values(byEntity).flat()
          const clientTotal = allBills.reduce((a,b)=>a+(b.amount||0),0)
          const nDocs = allBills.length
          const vencidoMonto = allBills.filter(b=>b.status==='Vencido').reduce((a,b)=>a+(b.amount||0),0)
          const isOpen = openClients.has(client.id)
          return (
            <div key={client.id} style={{marginBottom:isOpen?16:8}}>
              {/* Header cliente (clickeable) */}
              <button onClick={()=>toggleClient(client.id)} style={{width:'100%',display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:isOpen?6:0,paddingBottom:4,borderBottom:`2px solid ${C.accent}`,background:'none',border:'none',borderBottomColor:C.accent,cursor:'pointer',textAlign:'left'}}>
                <div style={{display:'flex',alignItems:'center',gap:8,minWidth:0}}>
                  <span style={{fontSize:12,color:C.accent,transform:isOpen?'rotate(90deg)':'none',transition:'transform .15s',display:'inline-block',flexShrink:0}}>▸</span>
                  <div style={{minWidth:0}}>
                    <div style={{fontSize:13,fontWeight:700,color:C.accent,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{client.name}</div>
                    {!isOpen&&<div style={{fontSize:10,color:C.muted,marginTop:1}}>{nDocs} doc{nDocs!==1?'s':''}{vencidoMonto>0&&<span style={{color:C.overdue,fontWeight:700}}> · {fmt(vencidoMonto)} vencido</span>}</div>}
                  </div>
                </div>
                <div style={{fontSize:12,fontWeight:700,color:C.text,flexShrink:0,marginLeft:8}}>{fmt(clientTotal)}</div>
              </button>
              {/* Por razón social (solo si abierto) */}
              {isOpen&&Object.entries(byEntity).map(([ename,bills])=>(
                <div key={ename} style={{marginBottom:10,marginLeft:8}}>
                  {ename!=='—'&&<div style={{fontSize:11,fontWeight:600,color:C.muted,marginBottom:4,display:'flex',alignItems:'center',justifyContent:'space-between',gap:4}}>
                    <div style={{display:'flex',alignItems:'center',gap:4}}>
                      <span style={{width:4,height:4,borderRadius:'50%',background:C.muted,display:'inline-block'}}/>
                      {ename}
                    </div>
                    <span style={{fontSize:11,fontWeight:700,color:C.muted}}>{fmt(bills.reduce((a,b)=>a+(b.amount||0),0))}</span>
                  </div>}
                  {bills.map(b=>(
                    <div key={b.id} style={{background:C.card,borderRadius:10,padding:'10px 12px',marginBottom:6,border:`1px solid ${C.border}`}}>
                      <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:4}}>
                        <div style={{minWidth:0,flex:1,display:'flex',gap:8,alignItems:'flex-start'}}>
                          {isProg&&<input type='checkbox' checked={selected.has(b.id)} onChange={()=>toggleSel(b.id)} style={{marginTop:3,flexShrink:0,cursor:'pointer'}}/>}
                          <div style={{minWidth:0,flex:1}}>
                            <div style={{display:'flex',gap:6,alignItems:'center',flexWrap:'wrap'}}>
                              {b.billing_type==='reembolso'&&<span style={{fontSize:10,padding:'1px 7px',borderRadius:10,background:'#F2E9DE',color:'#8B5C2A',fontWeight:600,flexShrink:0}}>Reembolso</span>}
                            </div>
                            <div style={{fontSize:12,color:C.text,fontWeight:500,marginTop:2}}>{b.concept||'—'}</div>
                          </div>
                        </div>
                        <div style={{display:'flex',alignItems:'center',gap:6,flexShrink:0,marginLeft:8}}>
                          <div style={{fontSize:14,fontWeight:700,color:b.status==='Vencido'?C.overdue:C.text}}>{fmt(b.amount)}</div>
                          <button onClick={()=>onEdit(b)} style={{background:'none',border:`1px solid ${C.border}`,borderRadius:6,padding:'2px 7px',fontSize:11,color:C.muted,cursor:'pointer'}}>✎</button>
                        </div>
                      </div>
                      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                        <div style={{display:'flex',gap:6,alignItems:'center'}}>
                          {b.status==='Programada'?(
                            <span style={{fontSize:11,color:C.muted}}>Facturar: {fmtDate(b.due)}</span>
                          ):(<>
                            <span style={{fontSize:11,color:C.muted,fontFamily:'monospace'}}>{b.invoice_no||'—'}</span>
                            <span style={{fontSize:11,color:C.muted}}>· {fmtDate(b.issued_at)}</span>
                            {b.status!=='Pagado'&&<DaysBadge due={b.due} status={b.status}/>}
                            {b.status==='Pagado'&&b.paid_at&&<span style={{fontSize:10,color:C.normal,fontWeight:600}}>Pagado {fmtDate(b.paid_at)}</span>}
                          </>)}
                        </div>
                        {b.status==='Programada'?(
                          selected.size===0&&(
                          <button onClick={()=>marcarEmitida(b)} style={{display:'flex',alignItems:'center',gap:5,padding:'4px 10px',borderRadius:20,border:`1px solid ${C.accent}`,cursor:'pointer',background:'transparent',color:C.accent,fontSize:11,fontWeight:700}}>
                            Ya emitida
                          </button>
                          )
                        ):(<>
                          {client.id==='__none__'&&onAssignClient&&<AsignarClienteInline bill={b} clients={clients} onAssign={onAssignClient}/>}
                          <button onClick={()=>handleTogglePagado(b)} style={{display:'flex',alignItems:'center',gap:5,padding:'4px 10px',borderRadius:20,border:'none',cursor:'pointer',background:b.status==='Pagado'?'#E4F1EA':'#F0F0F0',color:b.status==='Pagado'?C.normal:C.muted,fontSize:11,fontWeight:700}}>
                            <span style={{width:14,height:14,borderRadius:'50%',background:b.status==='Pagado'?C.normal:'#ccc',display:'flex',alignItems:'center',justifyContent:'center',fontSize:9,color:'#fff',flexShrink:0}}>{b.status==='Pagado'?'✓':''}</span>
                            {b.status==='Pagado'?'Pagado':'Marcar pagado'}
                          </button>
                          </>)}
                      </div>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )
        })}
      </div>
    </div>
  )
}


function BillingForm({bill,clients,clientEntities,onSave,onClose,onDelete,saving}) {
  const [f,setF] = useState(bill||{client_id:'',concept:'',amount:'',monto_terceros:'',status:'Pendiente',invoice_no:'',issued_at:'',due:'',paid_at:'',notes:'',billing_type:'honorarios',receptor_name:'',receptor_rut:''})
  const [clientQuery,setClientQuery] = useState('')
  const [nuevaRS,setNuevaRS] = useState(false)
  const up=(k,v)=>setF(p=>({...p,[k]:v}))
  const rsList = (clientEntities||[]).filter(e=>e.client_id===f.client_id)
  return (
    <>
      <Fld label='Cliente'>
        {f.client_id ? (
          <div style={{display:'flex',alignItems:'center',gap:8,padding:'10px 12px',borderRadius:8,border:`1px solid ${C.accent}`,background:'#E6EEF1',boxSizing:'border-box'}}>
            <span style={{flex:1,fontSize:14,color:C.text,fontWeight:600}}>{clients.find(c=>String(c.id)===String(f.client_id))?.name||'Cliente'}</span>
            <button type='button' onClick={()=>{up('client_id','');setClientQuery('')}} style={{border:'none',background:'transparent',color:C.muted,fontSize:13,cursor:'pointer',fontWeight:600}}>Cambiar</button>
          </div>
        ) : (
          <div>
            <input value={clientQuery} onChange={e=>setClientQuery(e.target.value)} placeholder='Buscar cliente por nombre...' style={{width:'100%',padding:'10px 12px',borderRadius:8,border:`1px solid ${C.border}`,background:'#F7F7F7',color:C.text,fontSize:14,boxSizing:'border-box'}}/>
            {clientQuery.trim() && (
              <div style={{maxHeight:180,overflowY:'auto',border:`1px solid ${C.border}`,borderRadius:8,marginTop:4,background:'#fff'}}>
                {clients.filter(c=>c.name.toLowerCase().includes(clientQuery.toLowerCase())).slice(0,30).map(c=>(
                  <div key={c.id} onClick={()=>{up('client_id',c.id);setClientQuery('')}} style={{padding:'9px 12px',fontSize:13,color:C.text,cursor:'pointer',borderBottom:`1px solid ${C.border}`}} onMouseEnter={e=>e.currentTarget.style.background='#F2F2F2'} onMouseLeave={e=>e.currentTarget.style.background='#fff'}>{c.name}</div>
                ))}
                {clients.filter(c=>c.name.toLowerCase().includes(clientQuery.toLowerCase())).length===0 && <div style={{padding:'9px 12px',fontSize:13,color:C.muted}}>Sin resultados</div>}
              </div>
            )}
          </div>
        )}
      </Fld>
      <Fld label='Tipo de cobro'>
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8}}>
          {[['honorarios','Honorarios'],['reembolso','Reembolso gastos']].map(([v,l])=>(
            <button key={v} type='button' onClick={()=>up('billing_type',v)} style={{padding:'9px',borderRadius:8,border:`2px solid ${f.billing_type===v?C.accent:C.border}`,background:f.billing_type===v?'#E6EEF1':'transparent',color:f.billing_type===v?C.accent:C.muted,fontSize:12,fontWeight:700,cursor:'pointer'}}>{l}</button>
          ))}
        </div>
      </Fld>
      <Fld label='Concepto'><Inp value={f.concept||''} onChange={e=>up('concept',e.target.value)} placeholder='Descripcion del cobro...'/></Fld>
      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10}}>
        <Fld label='Monto total (CLP)'><Inp type='number' value={f.amount||''} onChange={e=>up('amount',e.target.value)} placeholder='0'/></Fld>
        <Fld label='De terceros (CLP)'><Inp type='number' value={f.monto_terceros||''} onChange={e=>up('monto_terceros',e.target.value)} placeholder='0'/></Fld>
        <Fld label='Estado'><Sel value={f.status||'Pendiente'} onChange={e=>up('status',e.target.value)} options={['Propuesta','Pendiente','Pagado','Vencido','Anulado']}/></Fld>
        <Fld label='N Factura'><Inp value={f.invoice_no||''} onChange={e=>up('invoice_no',e.target.value)} placeholder='367...'/></Fld>
      </div>
      {f.client_id&&(
        <Fld label='Razón social'>
          {!nuevaRS&&rsList.length>0?(
            <select value={f.receptor_rut||''} onChange={e=>{
              if(e.target.value==='__nueva__'){setNuevaRS(true);up('receptor_name','');up('receptor_rut','')}
              else{const ce=rsList.find(x=>x.rut===e.target.value);up('receptor_name',ce?.name||'');up('receptor_rut',ce?.rut||'')}
            }} style={{width:'100%',padding:'10px 12px',borderRadius:8,border:`1px solid ${C.border}`,background:'#F7F7F7',color:C.text,fontSize:14,boxSizing:'border-box'}}>
              <option value=''>— Sin especificar —</option>
              {rsList.map(e=><option key={e.id} value={e.rut||e.name}>{e.name}{e.rut?` · ${e.rut}`:''}</option>)}
              <option value='__nueva__'>+ Nueva razón social...</option>
            </select>
          ):(
            <div style={{display:'flex',flexDirection:'column',gap:6}}>
              <Inp value={f.receptor_name||''} onChange={e=>up('receptor_name',e.target.value)} placeholder='Nombre / razón social'/>
              <Inp value={f.receptor_rut||''} onChange={e=>up('receptor_rut',e.target.value)} placeholder='RUT (76.xxx.xxx-x)'/>
              {rsList.length>0&&<button type='button' onClick={()=>{setNuevaRS(false);up('receptor_name','');up('receptor_rut','')}} style={{alignSelf:'flex-start',background:'none',border:'none',color:C.accent,fontSize:12,fontWeight:600,cursor:'pointer'}}>← Elegir de las existentes</button>}
            </div>
          )}
        </Fld>
      )}
      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10}}>
        <Fld label='Emision'><Inp type='date' value={f.issued_at||''} onChange={e=>up('issued_at',e.target.value)}/></Fld>
        <Fld label='Vencimiento'><Inp type='date' value={f.due||''} onChange={e=>up('due',e.target.value)}/></Fld>
        {f.status==='Pagado'&&<Fld label='Fecha de pago'><Inp type='date' value={f.paid_at||''} onChange={e=>up('paid_at',e.target.value)}/></Fld>}
      </div>
      <Fld label='Notas'><Txt value={f.notes||''} onChange={e=>up('notes',e.target.value)} placeholder='Observaciones...'/></Fld>
      <div style={{display:'flex',gap:8,marginTop:4}}>
        {bill?.id&&<button onClick={()=>onDelete(bill.id)} style={{padding:'11px 14px',borderRadius:10,border:`1px solid ${C.overdue}`,background:'transparent',color:C.overdue,fontSize:13,fontWeight:600,cursor:'pointer'}}>Eliminar</button>}
        <button onClick={onClose} style={{flex:1,padding:11,borderRadius:10,border:`1px solid ${C.border}`,background:'transparent',color:C.muted,fontSize:13,fontWeight:600,cursor:'pointer'}}>Cancelar</button>
        <button disabled={saving||!f.client_id||!f.concept} onClick={()=>onSave(f)} style={{flex:2,padding:11,borderRadius:10,border:'none',background:C.accent,color:'#fff',fontSize:13,fontWeight:700,cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center',gap:8,opacity:(!f.client_id||!f.concept)?.6:1}}>
          {saving?<Spin/>:null}{saving?'Guardando...':'Guardar'}
        </button>
      </div>
    </>
  )
}

// ─── EXPENSES VIEW ────────────────────────────────────────────────────────────
function RendicionModal({client, expenses, onClose}) {
  const [periodType, setPeriodType] = useState('month') // month | year | custom
  const [selYear, setSelYear] = useState(String(currentYear))
  const [selMonth, setSelMonth] = useState(String(currentMonth))
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')
  const MONTHS = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre']

  const allMovs = expenses.filter(e=>e.client_id===client.id).sort((a,b)=>new Date(a.date||0)-new Date(b.date||0))

  const filtered = useMemo(()=>{
    if(periodType==='month') return allMovs.filter(e=>e.date?.startsWith(`${selYear}-${String(selMonth).padStart(2,'0')}`))
    if(periodType==='year') return allMovs.filter(e=>e.date?.startsWith(selYear))
    if(periodType==='custom') {
      return allMovs.filter(e=>{
        if(!e.date) return false
        if(fromDate&&e.date<fromDate) return false
        if(toDate&&e.date>toDate) return false
        return true
      })
    }
    return allMovs
  },[allMovs,periodType,selYear,selMonth,fromDate,toDate])

  const getPeriodLabel = () => {
    if(periodType==='month') return `${MONTHS[parseInt(selMonth)-1]} ${selYear}`
    if(periodType==='year') return `Año ${selYear}`
    if(periodType==='custom'&&fromDate&&toDate) return `${fromDate} al ${toDate}`
    return 'Período seleccionado'
  }

  const fondos = filtered.filter(e=>e.type==='fondo').reduce((a,e)=>a+e.amount,0)
  const gastos = filtered.filter(e=>e.type==='gasto').reduce((a,e)=>a+e.amount,0)
  const saldo = fondos - gastos
  const byCat = {}
  filtered.filter(e=>e.type==='gasto').forEach(e=>{ byCat[e.category||'Otro']=(byCat[e.category||'Otro']||0)+e.amount })

  const years = [...new Set(allMovs.map(e=>e.date?.slice(0,4)).filter(Boolean))].sort((a,b)=>b-a)
  if(!years.length) years.push(String(currentYear))

  const CATS_COLOR = {'Notaria':'#E3EEF3','CBR':'#F2E9DE','Diario Oficial':'#ECE6F5','Fondo':'#E4F1EA','Otro':'#ECECEC'}
  const CATS_TEXT = {'Notaria':'#2A5F7F','CBR':'#8B5C2A','Diario Oficial':'#5C3D8B','Fondo':'#2E7D55','Otro':'#56616B'}

  const generatePDF = () => {
    const label = getPeriodLabel()
    const now = new Date().toLocaleDateString('es-CL',{day:'2-digit',month:'long',year:'numeric'})
    const fmtN = n => new Intl.NumberFormat('es-CL',{style:'currency',currency:'CLP',maximumFractionDigits:0}).format(n||0)
    const A='#003C50', A2='#537281', A4='#E4E8EB', G='#3D3D3D'

    let html = `<!DOCTYPE html><html><head><meta charset="UTF-8">
<title>Rendición — ${client.name} — ${label}</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600;700&display=swap');
  *{margin:0;padding:0;box-sizing:border-box}
  body{font-family:'DM Sans',sans-serif;color:${G};background:#fff;font-size:11px;padding:0}
  @page{size:letter portrait;margin:16mm 18mm 16mm 18mm}
  @media print{body{-webkit-print-color-adjust:exact;print-color-adjust:exact}.no-print{display:none}}
  .header{background:${A};color:#fff;padding:20px 24px;margin-bottom:20px}
  .header-top{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:8px}
  .firma{font-size:16px;font-weight:700;letter-spacing:-.3px}
  .firma-sub{font-size:9px;opacity:.7;letter-spacing:.5px;text-transform:uppercase;margin-top:2px}
  .doc-info{text-align:right}
  .doc-title{font-size:13px;font-weight:600;margin-bottom:2px}
  .doc-sub{font-size:9px;opacity:.8}
  .client-name{font-size:20px;font-weight:700;margin-top:6px}
  .kpi-row{display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;margin-bottom:18px}
  .kpi{background:${A4};border-radius:6px;padding:10px 12px}
  .kpi-label{font-size:9px;color:${A2};text-transform:uppercase;letter-spacing:.5px;margin-bottom:3px;font-weight:600}
  .kpi-value{font-size:15px;font-weight:700}
  table{width:100%;border-collapse:collapse;font-size:10px;margin-bottom:16px}
  thead tr{background:${A};color:#fff}
  thead th{padding:6px 10px;text-align:left;font-size:9px;font-weight:600;text-transform:uppercase;letter-spacing:.4px}
  tbody tr:nth-child(even){background:${A4}}
  tbody td{padding:6px 10px;border-bottom:1px solid ${A4}}
  tfoot tr{background:${A4};font-weight:700}
  tfoot td{padding:7px 10px;border-top:2px solid ${A2}}
  .badge{display:inline-block;padding:2px 7px;border-radius:10px;font-size:9px;font-weight:700}
  .subtotal-section{margin-bottom:16px}
  .subtotal-title{font-size:10px;font-weight:700;color:${A};text-transform:uppercase;letter-spacing:.5px;margin-bottom:8px;border-bottom:1px solid ${A4};padding-bottom:4px}
  .subtotal-row{display:flex;justify-content:space-between;padding:5px 0;border-bottom:1px solid ${A4};font-size:10px}
  .footer{margin-top:24px;padding-top:10px;border-top:1px solid ${A4};display:flex;justify-content:space-between;font-size:9px;color:${A2}}
  .print-btn{position:fixed;bottom:20px;right:20px;background:${A};color:#fff;border:none;padding:10px 20px;border-radius:8px;font-size:12px;font-weight:600;cursor:pointer;font-family:'DM Sans',sans-serif;box-shadow:0 4px 16px rgba(0,60,80,.3)}
  .saldo-pos{color:#2E7D55} .saldo-neg{color:#C2382B}
</style></head><body>
<div class="header">
  <div class="header-top">
    <div>
      <div class="firma">Liberona Escala Abogados</div>
      <div class="firma-sub">Av. Presidente Kennedy 7900, of. 905 · Vitacura, Santiago · leabogados.cl</div>
    </div>
    <div class="doc-info">
      <div class="doc-title">Rendición de Fondos</div>
      <div class="doc-sub">${label} · ${now}</div>
    </div>
  </div>
  <div class="client-name">${client.name}</div>
</div>

<div class="kpi-row">
  <div class="kpi"><div class="kpi-label">Fondos recibidos</div><div class="kpi-value" style="color:#2E7D55">${fmtN(fondos)}</div></div>
  <div class="kpi"><div class="kpi-label">Gastos realizados</div><div class="kpi-value" style="color:#C2382B">${fmtN(gastos)}</div></div>
  <div class="kpi"><div class="kpi-label">Saldo</div><div class="kpi-value ${saldo>=0?'saldo-pos':'saldo-neg'}">${fmtN(saldo)}</div></div>
</div>`

    // Tabla de movimientos
    html += `<table><thead><tr><th>Fecha</th><th>Tipo</th><th>Descripción</th><th style="text-align:right">Monto</th></tr></thead><tbody>`
    filtered.forEach(e=>{
      const isFondo = e.type==='fondo'
      const bg = CATS_COLOR[e.category]||CATS_COLOR['Otro']
      const tc = CATS_TEXT[e.category]||CATS_TEXT['Otro']
      const badgeLabel = isFondo ? 'Fondo' : (e.category||'Otro')
      const badgeBg = isFondo ? '#E4F1EA' : bg
      const badgeTc = isFondo ? '#2E7D55' : tc
      html += `<tr>
        <td>${e.date||'—'}</td>
        <td><span class="badge" style="background:${badgeBg};color:${badgeTc}">${badgeLabel}</span></td>
        <td>${e.concept||'—'}</td>
        <td style="text-align:right;font-weight:600;color:${isFondo?'#2E7D55':'#C2382B'}">${isFondo?'+':'-'}${fmtN(e.amount)}</td>
      </tr>`
    })
    html += `</tbody><tfoot><tr><td colspan="3">SALDO</td><td style="text-align:right;color:${saldo>=0?'#2E7D55':'#C2382B'}">${fmtN(saldo)}</td></tr></tfoot></table>`

    // Subtotales por categoría
    if(Object.keys(byCat).length>0){
      html += `<div class="subtotal-section"><div class="subtotal-title">Detalle por categoría</div>`
      Object.entries(byCat).sort((a,b)=>b[1]-a[1]).forEach(([cat,amt])=>{
        html += `<div class="subtotal-row"><span>${cat}</span><span style="font-weight:600;color:#C2382B">-${fmtN(amt)}</span></div>`
      })
      html += `</div>`
    }

    html += `<div class="footer"><span>Liberona Escala Abogados · leabogados.cl</span><span>CONFIDENCIAL</span></div>
<button class="print-btn no-print" onclick="window.print()">Imprimir / Guardar PDF</button>
</body></html>`

    const win = window.open('','_blank')
    win.document.write(html)
    win.document.close()
    setTimeout(()=>win.focus(),300)
  }

  const generateExcel = async() => {
    try {
      const XLSX = await import('https://cdn.sheetjs.com/xlsx-0.20.1/package/xlsx.mjs')
      const label = getPeriodLabel()
      const wb = XLSX.utils.book_new()
      const movData = [
        ['RENDICIÓN DE FONDOS'],
        ['Cliente:', client.name],
        ['Período:', label],
        ['Fecha generación:', new Date().toLocaleDateString('es-CL')],
        ['Dirección:', 'Av. Presidente Kennedy 7900, of. 905, Vitacura, Santiago'],
        [],
        ['Fecha','Tipo','Categoría','Descripción','Monto'],
        ...filtered.map(e=>[e.date||'', e.type==='fondo'?'Fondo recibido':'Gasto', e.type==='fondo'?'—':(e.category||'Otro'), e.concept||'', e.type==='fondo'?e.amount:-e.amount]),
        [],
        ['SUBTOTALES POR CATEGORÍA'],
        ['Categoría','Monto'],
        ...Object.entries(byCat).map(([cat,amt])=>[cat,-amt]),
        [],
        ['RESUMEN GENERAL'],
        ['Fondos recibidos', fondos],
        ['Total gastos', -gastos],
        ['Saldo', saldo],
      ]
      const ws = XLSX.utils.aoa_to_sheet(movData)
      ws['!cols'] = [{wch:12},{wch:16},{wch:16},{wch:40},{wch:16}]
      XLSX.utils.book_append_sheet(wb, ws, 'Rendición')
      const fname = `Rendicion_${client.name.replace(/[^a-zA-Z0-9]/g,'_')}_${label.replace(/\s+/g,'_')}.xlsx`
      XLSX.writeFile(wb, fname)
    } catch(e) {
      alert('Error al generar Excel: '+e.message)
    }
  }

  return (
    <div>
      {/* Selector de período */}
      <div style={{marginBottom:16}}>
        <Lbl>Período</Lbl>
        <div style={{display:'flex',gap:6,marginBottom:10}}>
          {[['month','Por mes'],['year','Por año'],['custom','Rango']].map(([v,l])=>(
            <button key={v} onClick={()=>setPeriodType(v)} style={{flex:1,padding:'7px',borderRadius:8,border:`1px solid ${periodType===v?C.accent:C.border}`,background:periodType===v?'#E6EEF1':'transparent',color:periodType===v?C.accent:C.muted,fontSize:11,fontWeight:600,cursor:'pointer'}}>{l}</button>
          ))}
        </div>
        {periodType==='month'&&(
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8}}>
            <select value={selYear} onChange={e=>setSelYear(e.target.value)} style={{padding:'9px 12px',borderRadius:8,border:`1px solid ${C.border}`,background:'#F7F7F7',color:C.text,fontSize:13}}>
              {years.map(y=><option key={y} value={y}>{y}</option>)}
            </select>
            <select value={selMonth} onChange={e=>setSelMonth(e.target.value)} style={{padding:'9px 12px',borderRadius:8,border:`1px solid ${C.border}`,background:'#F7F7F7',color:C.text,fontSize:13}}>
              {MONTHS.map((m,i)=><option key={i+1} value={i+1}>{m}</option>)}
            </select>
          </div>
        )}
        {periodType==='year'&&(
          <select value={selYear} onChange={e=>setSelYear(e.target.value)} style={{width:'100%',padding:'9px 12px',borderRadius:8,border:`1px solid ${C.border}`,background:'#F7F7F7',color:C.text,fontSize:13}}>
            {years.map(y=><option key={y} value={y}>{y}</option>)}
          </select>
        )}
        {periodType==='custom'&&(
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8}}>
            <Fld label='Desde'><Inp type='date' value={fromDate} onChange={e=>setFromDate(e.target.value)}/></Fld>
            <Fld label='Hasta'><Inp type='date' value={toDate} onChange={e=>setToDate(e.target.value)}/></Fld>
          </div>
        )}
      </div>

      {/* Preview saldo */}
      {filtered.length>0?(
        <div style={{background:'#F7F7F7',borderRadius:10,padding:'12px 14px',marginBottom:16}}>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:8}}>
            <div><div style={{fontSize:9,color:C.muted,textTransform:'uppercase',letterSpacing:.5,marginBottom:2}}>Fondos</div><div style={{fontSize:13,fontWeight:700,color:C.normal}}>{fmt(fondos)}</div></div>
            <div><div style={{fontSize:9,color:C.muted,textTransform:'uppercase',letterSpacing:.5,marginBottom:2}}>Gastos</div><div style={{fontSize:13,fontWeight:700,color:C.overdue}}>{fmt(gastos)}</div></div>
            <div><div style={{fontSize:9,color:C.muted,textTransform:'uppercase',letterSpacing:.5,marginBottom:2}}>Saldo</div><div style={{fontSize:13,fontWeight:700,color:saldo>=0?C.normal:C.overdue}}>{fmt(saldo)}</div></div>
          </div>
          <div style={{fontSize:11,color:C.muted,marginTop:8}}>{filtered.length} movimiento{filtered.length!==1?'s':''} · {getPeriodLabel()}</div>
        </div>
      ):(
        <div style={{background:'#F7F7F7',borderRadius:10,padding:'12px 14px',marginBottom:16,fontSize:12,color:C.muted,textAlign:'center'}}>Sin movimientos en este período</div>
      )}

      {/* Botones */}
      <div style={{display:'flex',gap:8}}>
        <button onClick={onClose} style={{flex:1,padding:11,borderRadius:10,border:`1px solid ${C.border}`,background:'transparent',color:C.muted,fontSize:13,fontWeight:600,cursor:'pointer'}}>Cancelar</button>
        <button disabled={!filtered.length} onClick={generateExcel} style={{flex:1,padding:11,borderRadius:10,border:`1px solid ${C.accent}`,background:'transparent',color:C.accent,fontSize:13,fontWeight:600,cursor:'pointer',opacity:!filtered.length?.5:1}}>↓ Excel</button>
        <button disabled={!filtered.length} onClick={generatePDF} style={{flex:1,padding:11,borderRadius:10,border:'none',background:C.accent,color:'#fff',fontSize:13,fontWeight:700,cursor:'pointer',opacity:!filtered.length?.5:1}}>↓ PDF</button>
      </div>
    </div>
  )
}

function ExpensesView({expenses,clients,onAdd,onEdit,onAddFondo}) {
  const [selectedClient,setSelectedClient] = useState(null)
  const [q,setQ] = useState('')
  const [rendicionClient,setRendicionClient] = useState(null)

  const balances = useMemo(()=>{
    const m={}
    expenses.forEach(e=>{
      if(!m[e.client_id]) m[e.client_id]={fondos:0,gastos:0}
      if(e.type==='fondo') m[e.client_id].fondos+=e.amount
      else m[e.client_id].gastos+=e.amount
    })
    return m
  },[expenses])

  // Clientes con movimientos, ordenados: negativos primero, luego por nombre
  const clientsWithMovs = useMemo(()=>{
    return clients
      .filter(c=>balances[c.id])
      .sort((a,b)=>{
        const sa=(balances[a.id]?.fondos||0)-(balances[a.id]?.gastos||0)
        const sb=(balances[b.id]?.fondos||0)-(balances[b.id]?.gastos||0)
        if(sa<0&&sb>=0) return -1
        if(sb<0&&sa>=0) return 1
        return a.name.localeCompare(b.name,'es')
      })
  },[clients,balances])

  const filteredClients = useMemo(()=>{
    if(!q.trim()) return clientsWithMovs
    return clientsWithMovs.filter(c=>c.name.toLowerCase().includes(q.toLowerCase()))
  },[clientsWithMovs,q])

  const filtered = useMemo(()=>{
    if(!selectedClient) return []
    return expenses.filter(e=>e.client_id===selectedClient.id).sort((a,b)=>new Date(b.date||0)-new Date(a.date||0))
  },[expenses,selectedClient])

  const CATS = {'Notaria':'#E3EEF3','CBR':'#F2E9DE','Diario Oficial':'#ECE6F5','Fondo':'#E4F1EA','Otro':'#ECECEC'}

  const clientBalance = selectedClient ? (balances[selectedClient.id]||{}) : null
  const saldo = clientBalance ? clientBalance.fondos - clientBalance.gastos : 0

  return (
    <div>
      <div style={{padding:'20px 20px 10px',position:'sticky',top:0,background:C.bg,zIndex:10}}>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:10}}>
          <div style={{display:'flex',alignItems:'center',gap:8}}>
            {selectedClient&&(
              <button onClick={()=>setSelectedClient(null)} style={{background:'none',border:'none',color:C.muted,cursor:'pointer',fontSize:18,lineHeight:1,padding:'0 4px 0 0'}}>←</button>
            )}
            <div style={{fontSize:20,fontWeight:600,color:C.text,fontFamily:"'DM Sans',sans-serif",letterSpacing:-.4}}>
              {selectedClient?selectedClient.name:'Gastos y Fondos'}
            </div>
          </div>
          <div style={{display:'flex',gap:6}}>
            {selectedClient&&(
              <button onClick={()=>setRendicionClient(selectedClient)} style={{padding:'6px 12px',borderRadius:8,border:`1px solid ${C.border}`,background:'#fff',color:C.accent,fontSize:12,fontWeight:600,cursor:'pointer'}}>↓ Rendir</button>
            )}
            <button onClick={onAddFondo} style={{padding:'6px 12px',borderRadius:8,border:`1px solid ${C.border}`,background:'#fff',color:C.normal,fontSize:12,fontWeight:600,cursor:'pointer'}}>+ Fondo</button>
            <button onClick={onAdd} style={{padding:'6px 14px',borderRadius:8,border:'none',background:C.accent,color:'#fff',fontSize:12,fontWeight:600,cursor:'pointer'}}>+ Gastos</button>
          </div>
        </div>

        {/* Vista cliente seleccionado: saldo */}
        {selectedClient&&clientBalance&&(
          <div style={{background:C.card,borderRadius:10,padding:'12px 14px',border:`1px solid ${saldo<0?C.overdue:C.border}`,marginBottom:8}}>
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:8}}>
              <div>
                <div style={{fontSize:10,color:C.muted,marginBottom:2}}>FONDOS</div>
                <div style={{fontSize:13,fontWeight:700,color:C.normal}}>{fmt(clientBalance.fondos||0)}</div>
              </div>
              <div>
                <div style={{fontSize:10,color:C.muted,marginBottom:2}}>GASTOS</div>
                <div style={{fontSize:13,fontWeight:700,color:C.overdue}}>{fmt(clientBalance.gastos||0)}</div>
              </div>
              <div>
                <div style={{fontSize:10,color:C.muted,marginBottom:2}}>SALDO</div>
                <div style={{fontSize:13,fontWeight:700,color:saldo<0?C.overdue:C.normal}}>{fmt(saldo)}</div>
              </div>
            </div>
          </div>
        )}

        {/* Vista general: búsqueda */}
        {!selectedClient&&(
          <Inp value={q} onChange={e=>setQ(e.target.value)} placeholder='Buscar cliente...' style={{marginBottom:4}}/>
        )}
      </div>

      {/* Vista general: lista de clientes con saldo */}
      {!selectedClient&&(
        <div style={{padding:'4px 20px 100px'}}>
          {filteredClients.length===0&&<div style={{color:C.muted,textAlign:'center',padding:40}}>Sin registros</div>}
          {filteredClients.map(c=>{
            const b=balances[c.id]||{fondos:0,gastos:0}
            const sal=b.fondos-b.gastos
            return (
              <div key={c.id} onClick={()=>setSelectedClient(c)} style={{background:C.card,borderRadius:10,padding:'12px 14px',marginBottom:8,border:`1px solid ${C.border}`,borderLeft:`3px solid ${sal<0?C.overdue:C.normal}`,cursor:'pointer'}}
                onMouseEnter={x=>x.currentTarget.style.boxShadow='0 2px 12px rgba(0,0,0,.08)'}
                onMouseLeave={x=>x.currentTarget.style.boxShadow='none'}>
                <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start'}}>
                  <div style={{fontWeight:600,fontSize:14,color:C.text,marginBottom:4}}>{c.name}</div>
                  <div style={{fontSize:15,fontWeight:700,color:sal<0?C.overdue:C.normal}}>{fmt(sal)}</div>
                </div>
                <div style={{display:'flex',gap:16,fontSize:11,color:C.muted}}>
                  <span>Fondos: {fmt(b.fondos)}</span>
                  <span>Gastos: {fmt(b.gastos)}</span>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Vista cliente: movimientos */}
      {selectedClient&&(
        <div style={{padding:'4px 20px 100px'}}>
          {filtered.length===0&&<div style={{color:C.muted,textAlign:'center',padding:40}}>Sin movimientos</div>}
          {filtered.map(e=>{
            const isFondo=e.type==='fondo'
            const catBg=CATS[e.category]||CATS['Otro']
            return (
              <div key={e.id} onClick={()=>onEdit(e)} style={{background:C.card,borderRadius:10,padding:'11px 14px',marginBottom:7,border:`1px solid ${C.border}`,borderLeft:`3px solid ${isFondo?C.normal:C.overdue}`,cursor:'pointer'}}
                onMouseEnter={x=>x.currentTarget.style.boxShadow='0 2px 12px rgba(0,0,0,.08)'}
                onMouseLeave={x=>x.currentTarget.style.boxShadow='none'}>
                <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start'}}>
                  <div style={{minWidth:0,flex:1}}>
                    <div style={{display:'flex',gap:6,alignItems:'center',marginBottom:2,flexWrap:'wrap'}}>
                      {!isFondo&&e.category&&<span style={{fontSize:10,padding:'1px 7px',borderRadius:3,background:catBg,color:'#56616B',fontWeight:600}}>{e.category}</span>}
                      {isFondo&&<span style={{fontSize:10,padding:'1px 7px',borderRadius:3,background:'#E4F1EA',color:C.normal,fontWeight:600}}>Fondo</span>}
                    </div>
                    <div style={{fontSize:13,color:C.text,fontWeight:500,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{e.concept||'—'}</div>
                    <div style={{fontSize:11,color:C.muted,marginTop:2}}>{fmtDate(e.date)}</div>
                  </div>
                  <div style={{textAlign:'right',flexShrink:0,marginLeft:12}}>
                    <div style={{fontSize:14,fontWeight:700,color:isFondo?C.normal:C.overdue}}>{isFondo?'+':'-'}{fmt(e.amount)}</div>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
      {rendicionClient&&<Modal title={`Rendición — ${rendicionClient.name}`} onClose={()=>setRendicionClient(null)}><RendicionModal client={rendicionClient} expenses={expenses} onClose={()=>setRendicionClient(null)}/></Modal>}
    </div>
  )
}

function FondoForm({clients,expenses,onSave,onClose,saving,preClient}) {
  const [q,setQ] = useState('')
  const [selectedClient,setSelectedClient] = useState(preClient||null)
  const [amount,setAmount] = useState('')
  const [concept,setConcept] = useState('')
  const [date,setDate] = useState(new Date().toISOString().slice(0,10))
  const matches = useMemo(()=>{ if(!q.trim()) return []; return clients.filter(c=>c.name.toLowerCase().includes(q.toLowerCase())).slice(0,6) },[clients,q])
  const balance = selectedClient ? (()=>{ let b=0; expenses.forEach(e=>{ if(e.client_id===selectedClient.id) b+=e.type==='fondo'?e.amount:-e.amount }); return b })() : null
  return (
    <>
      {!selectedClient?(
        <Fld label='Cliente'>
          <div style={{position:'relative'}}>
            <Inp value={q} onChange={e=>setQ(e.target.value)} placeholder='Buscar cliente...' autoFocus/>
            {matches.length>0&&(
              <div style={{position:'absolute',top:'100%',left:0,right:0,background:'#fff',border:`1px solid ${C.border}`,borderRadius:8,boxShadow:'0 4px 20px rgba(0,0,0,.12)',zIndex:100,marginTop:4,maxHeight:220,overflowY:'auto'}}>
                {matches.map(c=>(
                  <div key={c.id} onMouseDown={()=>{setSelectedClient(c);setQ('')}} style={{padding:'10px 14px',cursor:'pointer',borderBottom:`1px solid ${C.border}`,fontSize:13}}
                    onMouseEnter={e=>e.currentTarget.style.background='#F0F4F6'}
                    onMouseLeave={e=>e.currentTarget.style.background='#fff'}>
                    <div style={{fontWeight:500}}>{c.name}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </Fld>
      ):(
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:14,padding:'10px 14px',borderRadius:8,background:'#E6EEF1',border:`1px solid ${C.border}`}}>
          <div>
            <div style={{fontSize:13,fontWeight:600,color:C.accent}}>{selectedClient.name}</div>
            {balance!==null&&<div style={{fontSize:11,color:balance<0?C.overdue:C.normal}}>Saldo actual: {fmt(balance)}</div>}
          </div>
          <button onClick={()=>setSelectedClient(null)} style={{background:'none',border:'none',color:C.muted,fontSize:13,cursor:'pointer'}}>Cambiar</button>
        </div>
      )}
      {selectedClient&&(
        <>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10}}>
            <Fld label='Monto (CLP)'><Inp type='number' value={amount} onChange={e=>setAmount(e.target.value)} placeholder='0' autoFocus/></Fld>
            <Fld label='Fecha'><Inp type='date' value={date} onChange={e=>setDate(e.target.value)}/></Fld>
          </div>
          <Fld label='Descripción'><Inp value={concept} onChange={e=>setConcept(e.target.value)} placeholder='Ej: Provisión fondos abril...'/></Fld>
        </>
      )}
      <div style={{display:'flex',gap:8,marginTop:4}}>
        <button onClick={onClose} style={{flex:1,padding:11,borderRadius:10,border:`1px solid ${C.border}`,background:'transparent',color:C.muted,fontSize:13,fontWeight:600,cursor:'pointer'}}>Cancelar</button>
        <button disabled={saving||!selectedClient||!amount} onClick={()=>onSave({client_id:selectedClient.id,type:'fondo',amount:parseInt(amount),concept,date,category:'Fondo'})} style={{flex:2,padding:11,borderRadius:10,border:'none',background:C.normal,color:'#fff',fontSize:13,fontWeight:700,cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center',gap:8,opacity:(!selectedClient||!amount)?.6:1}}>
          {saving?<Spin/>:null}{saving?'Guardando...':'Guardar fondo'}
        </button>
      </div>
    </>
  )
}

// ── GASTOS FORM (tabla de ingreso rápido) ─────────────────────────────────────
const CATS_GASTO = ['Notaria','CBR','Diario Oficial','Otro']
function GastosForm({clients,expenses,onSave,onClose,preClient}) {
  const [q,setQ] = useState('')
  const [selectedClient,setSelectedClient] = useState(preClient||null)
  const [date,setDate] = useState(new Date().toISOString().slice(0,10))
  const [rows,setRows] = useState([{id:1,category:'CBR',concept:'',amount:''}])
  const [saving,setSaving] = useState(false)
  const [saved,setSaved] = useState(0)
  const matches = useMemo(()=>{ if(!q.trim()) return []; return clients.filter(c=>c.name.toLowerCase().includes(q.toLowerCase())).slice(0,6) },[clients,q])
  const balance = selectedClient ? (()=>{ let b=0; expenses.forEach(e=>{ if(e.client_id===selectedClient.id) b+=e.type==='fondo'?e.amount:-e.amount }); return b })() : null
  const total = rows.reduce((a,r)=>a+(parseInt(r.amount)||0),0)

  const addRow = () => setRows(p=>[...p,{id:Date.now(),category:'CBR',concept:'',amount:''}])
  const removeRow = id => setRows(p=>p.filter(r=>r.id!==id))
  const updateRow = (id,k,v) => setRows(p=>p.map(r=>r.id===id?{...r,[k]:v}:r))

  const handleKeyDown = (e,rowId,field) => {
    if(e.key==='Enter'||e.key==='Tab') {
      const idx = rows.findIndex(r=>r.id===rowId)
      if(field==='amount' && idx===rows.length-1) { e.preventDefault(); addRow() }
    }
  }

  const saveAll = async() => {
    const valid = rows.filter(r=>r.amount&&parseInt(r.amount)>0)
    if(!valid.length||!selectedClient) return
    setSaving(true)
    let count=0
    for(const r of valid) {
      try {
        await onSave({client_id:selectedClient.id,type:'gasto',amount:parseInt(r.amount),concept:r.concept,category:r.category,date,sale_id:null})
        count++
      } catch(e){ console.error(e) }
    }
    setSaved(count)
    setRows([{id:Date.now(),category:'CBR',concept:'',amount:''}])
    setSaving(false)
  }

  const inS = {padding:'7px 8px',borderRadius:6,border:`1px solid ${C.border}`,fontSize:13,background:'#F7F7F7',color:C.text,boxSizing:'border-box',outline:'none',width:'100%'}

  return (
    <>
      {!selectedClient?(
        <Fld label='Cliente'>
          <div style={{position:'relative'}}>
            <Inp value={q} onChange={e=>setQ(e.target.value)} placeholder='Buscar cliente...' autoFocus/>
            {matches.length>0&&(
              <div style={{position:'absolute',top:'100%',left:0,right:0,background:'#fff',border:`1px solid ${C.border}`,borderRadius:8,boxShadow:'0 4px 20px rgba(0,0,0,.12)',zIndex:100,marginTop:4,maxHeight:220,overflowY:'auto'}}>
                {matches.map(c=>(
                  <div key={c.id} onMouseDown={()=>{setSelectedClient(c);setQ('')}} style={{padding:'10px 14px',cursor:'pointer',borderBottom:`1px solid ${C.border}`,fontSize:13}}
                    onMouseEnter={e=>e.currentTarget.style.background='#F0F4F6'}
                    onMouseLeave={e=>e.currentTarget.style.background='#fff'}>
                    <div style={{fontWeight:500}}>{c.name}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </Fld>
      ):(
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:14,padding:'10px 14px',borderRadius:8,background:'#E6EEF1',border:`1px solid ${C.border}`}}>
          <div>
            <div style={{fontSize:13,fontWeight:600,color:C.accent}}>{selectedClient.name}</div>
            {balance!==null&&<div style={{fontSize:11,color:balance<0?C.overdue:C.normal}}>Saldo: {fmt(balance)}</div>}
          </div>
          <button onClick={()=>setSelectedClient(null)} style={{background:'none',border:'none',color:C.muted,fontSize:13,cursor:'pointer'}}>Cambiar</button>
        </div>
      )}

      {selectedClient&&(
        <>
          <Fld label='Fecha (aplica a todos)'>
            <Inp type='date' value={date} onChange={e=>setDate(e.target.value)}/>
          </Fld>

          {saved>0&&<div style={{fontSize:12,color:C.normal,marginBottom:8,fontWeight:600}}>✓ {saved} gasto{saved!==1?'s':''} guardado{saved!==1?'s':''}</div>}

          {/* Tabla de filas */}
          <div style={{marginBottom:8}}>
            <div style={{display:'grid',gridTemplateColumns:'90px 1fr 90px 28px',gap:4,marginBottom:4}}>
              <div style={{fontSize:10,color:C.muted,fontWeight:600,textTransform:'uppercase',letterSpacing:.5}}>Tipo</div>
              <div style={{fontSize:10,color:C.muted,fontWeight:600,textTransform:'uppercase',letterSpacing:.5}}>Descripción</div>
              <div style={{fontSize:10,color:C.muted,fontWeight:600,textTransform:'uppercase',letterSpacing:.5}}>Monto</div>
              <div/>
            </div>
            {rows.map((row,idx)=>(
              <div key={row.id} style={{display:'grid',gridTemplateColumns:'90px 1fr 90px 28px',gap:4,marginBottom:5}}>
                <select value={row.category} onChange={e=>updateRow(row.id,'category',e.target.value)} style={{...inS,fontSize:12}}>
                  {CATS_GASTO.map(c=><option key={c} value={c}>{c}</option>)}
                </select>
                <input value={row.concept} onChange={e=>updateRow(row.id,'concept',e.target.value)} placeholder='Descripción...' style={inS} onKeyDown={e=>handleKeyDown(e,row.id,'concept')}/>
                <input type='number' value={row.amount} onChange={e=>updateRow(row.id,'amount',e.target.value)} placeholder='0' style={{...inS,textAlign:'right'}} onKeyDown={e=>handleKeyDown(e,row.id,'amount')} autoFocus={idx===rows.length-1&&idx>0}/>
                <button onClick={()=>removeRow(row.id)} style={{background:'none',border:'none',color:C.muted,cursor:'pointer',fontSize:16,display:'flex',alignItems:'center',justifyContent:'center'}}>×</button>
              </div>
            ))}
          </div>

          <button onClick={addRow} style={{width:'100%',padding:'8px',borderRadius:8,border:`1px dashed ${C.border}`,background:'transparent',color:C.accent,fontSize:12,fontWeight:600,cursor:'pointer',marginBottom:12}}>+ Agregar fila</button>

          {total>0&&(
            <div style={{display:'flex',justifyContent:'space-between',padding:'8px 12px',borderRadius:8,background:'#F7F7F7',marginBottom:12}}>
              <span style={{fontSize:13,color:C.muted}}>Total {rows.filter(r=>r.amount).length} gasto{rows.filter(r=>r.amount).length!==1?'s':''}</span>
              <span style={{fontSize:14,fontWeight:700,color:C.overdue}}>-{fmt(total)}</span>
            </div>
          )}
        </>
      )}

      <div style={{display:'flex',gap:8}}>
        <button onClick={onClose} style={{flex:1,padding:11,borderRadius:10,border:`1px solid ${C.border}`,background:'transparent',color:C.muted,fontSize:13,fontWeight:600,cursor:'pointer'}}>Cerrar</button>
        {selectedClient&&<button disabled={saving||!rows.some(r=>r.amount&&parseInt(r.amount)>0)} onClick={saveAll} style={{flex:2,padding:11,borderRadius:10,border:'none',background:C.accent,color:'#fff',fontSize:13,fontWeight:700,cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center',gap:8,opacity:!rows.some(r=>r.amount)?.6:1}}>
          {saving?<Spin/>:null}{saving?'Guardando...':'Guardar todo'}
        </button>}
      </div>
    </>
  )
}

// ── EXPENSE EDIT FORM (editar/eliminar registro individual) ───────────────────
function ExpenseEditForm({expense,clients,onSave,onClose,onDelete,saving}) {
  const [f,setF] = useState({...expense,amount:expense.amount||'',concept:expense.concept||'',category:expense.category||'Otro'})
  const up=(k,v)=>setF(p=>({...p,[k]:v}))
  const client=clients.find(c=>c.id===f.client_id)
  const isFondo=f.type==='fondo'
  return (
    <>
      <div style={{padding:'8px 14px',borderRadius:8,background:'#F7F7F7',marginBottom:14,fontSize:13,color:C.muted}}>
        Cliente: <span style={{fontWeight:600,color:C.text}}>{client?.name||'—'}</span>
      </div>
      {!isFondo&&(
        <Fld label='Tipo'>
          <div style={{display:'flex',gap:6,flexWrap:'wrap'}}>
            {CATS_GASTO.map(c=>(
              <button key={c} type='button' onClick={()=>up('category',c)} style={{padding:'6px 12px',borderRadius:6,border:`1px solid ${f.category===c?C.accent:C.border}`,background:f.category===c?'#E6EEF1':'transparent',color:f.category===c?C.accent:C.muted,fontSize:12,fontWeight:600,cursor:'pointer'}}>{c}</button>
            ))}
          </div>
        </Fld>
      )}
      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10}}>
        <Fld label='Monto (CLP)'><Inp type='number' value={f.amount} onChange={e=>up('amount',e.target.value)}/></Fld>
        <Fld label='Fecha'><Inp type='date' value={f.date||''} onChange={e=>up('date',e.target.value)}/></Fld>
      </div>
      <Fld label='Descripción'><Inp value={f.concept} onChange={e=>up('concept',e.target.value)} placeholder='Descripción...'/></Fld>
      <div style={{display:'flex',gap:8,marginTop:4}}>
        <button onClick={()=>onDelete(expense.id)} style={{padding:'11px 14px',borderRadius:10,border:`1px solid ${C.overdue}`,background:'transparent',color:C.overdue,fontSize:13,fontWeight:600,cursor:'pointer'}}>Eliminar</button>
        <button onClick={onClose} style={{flex:1,padding:11,borderRadius:10,border:`1px solid ${C.border}`,background:'transparent',color:C.muted,fontSize:13,fontWeight:600,cursor:'pointer'}}>Cancelar</button>
        <button disabled={saving||!f.amount} onClick={()=>onSave({...f,amount:parseInt(f.amount)||0})} style={{flex:2,padding:11,borderRadius:10,border:'none',background:C.accent,color:'#fff',fontSize:13,fontWeight:700,cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center',gap:8}}>
          {saving?<Spin/>:null}{saving?'Guardando...':'Guardar'}
        </button>
      </div>
    </>
  )
}


// ─── CLIENTS VIEW ─────────────────────────────────────────────────────────────
function QuickTaskForm({clients,sales,tasks,onSave,onClose,saving,preClient}) {
  const [q,setQ] = useState('')
  const [selectedClient,setSelectedClient] = useState(preClient||null)
  const [f,setF] = useState({title:'',who:'Cristóbal',due:'',status:'Activo',note:'',sale_id:'',project:'',subproject:''})
  const [showProjects,setShowProjects] = useState(false)
  const [showSubprojects,setShowSubprojects] = useState(false)
  const up=(k,v)=>setF(p=>({...p,[k]:v}))
  const WHO = ['Cristóbal','Martín','Erasmo','Rodrigo','Martina']

  const matches = useMemo(()=>{
    if(!q.trim()) return []
    return clients.filter(c=>c.name.toLowerCase().includes(q.toLowerCase())).slice(0,6)
  },[clients,q])

  // Proyectos existentes del cliente: de tareas + de ventas
  const clientProjects = useMemo(()=>{
    if(!selectedClient) return []
    const fromTasks = tasks.filter(t=>t.client_id===selectedClient.id&&t.project).map(t=>t.project)
    const fromSales = sales.filter(s=>s.client_id===selectedClient.id&&s.title).map(s=>s.title)
    return [...new Set([...fromSales,...fromTasks])].sort()
  },[tasks,sales,selectedClient])

  const clientSubprojects = useMemo(()=>{
    if(!selectedClient) return []
    return [...new Set(tasks.filter(t=>t.client_id===selectedClient.id&&t.subproject).map(t=>t.subproject))].sort()
  },[tasks,selectedClient])

  const clientSales = sales.filter(s=>s.client_id===selectedClient?.id&&s.status==='Activo')

  return (
    <>
      {!selectedClient ? (
        <Fld label='Cliente'>
          <div style={{position:'relative'}}>
            <Inp value={q} onChange={e=>setQ(e.target.value)} placeholder='Escribe para buscar cliente...' autoFocus/>
            {matches.length>0&&(
              <div style={{position:'absolute',top:'100%',left:0,right:0,background:'#fff',border:`1px solid ${C.border}`,borderRadius:8,boxShadow:'0 4px 20px rgba(0,0,0,.12)',zIndex:100,marginTop:4,maxHeight:220,overflowY:'auto'}}>
                {matches.map(c=>(
                  <div key={c.id} onMouseDown={()=>{setSelectedClient(c);setQ('')}}
                    style={{padding:'10px 14px',cursor:'pointer',borderBottom:`1px solid ${C.border}`,fontSize:13}}
                    onMouseEnter={e=>e.currentTarget.style.background='#F0F4F6'}
                    onMouseLeave={e=>e.currentTarget.style.background='#fff'}>
                    <div style={{fontWeight:500,color:C.text}}>{c.name}</div>
                    {c.type&&<div style={{fontSize:11,color:C.muted}}>{c.type}</div>}
                  </div>
                ))}
              </div>
            )}
            {q.length>0&&matches.length===0&&(
              <div style={{position:'absolute',top:'100%',left:0,right:0,background:'#fff',border:`1px solid ${C.border}`,borderRadius:8,padding:'10px 14px',fontSize:13,color:C.muted,marginTop:4}}>
                Sin resultados para "{q}"
              </div>
            )}
          </div>
        </Fld>
      ) : (
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:14,padding:'10px 14px',borderRadius:8,background:'#E6EEF1',border:`1px solid ${C.border}`}}>
          <div>
            <div style={{fontSize:13,fontWeight:600,color:C.accent}}>{selectedClient.name}</div>
            {selectedClient.type&&<div style={{fontSize:11,color:C.muted}}>{selectedClient.type}</div>}
          </div>
          <button onClick={()=>{setSelectedClient(null);setF(p=>({...p,sale_id:'',project:''}))}} style={{background:'none',border:'none',color:C.muted,fontSize:13,cursor:'pointer'}}>Cambiar</button>
        </div>
      )}

      {selectedClient&&(
        <>
          <Fld label='Tarea'><textarea value={f.title} onChange={e=>up('title',e.target.value)} placeholder='Descripción de la tarea...' autoFocus rows={3} style={{width:'100%',padding:'10px 12px',borderRadius:8,border:`1px solid ${C.border}`,background:'#F7F7F7',color:C.text,fontSize:14,boxSizing:'border-box',resize:'vertical',fontFamily:'inherit'}}/></Fld>

          <Fld label='Proyecto (opcional)'>
            <div style={{position:'relative'}}>
              <Inp
                value={f.project||''}
                onChange={e=>up('project',e.target.value)}
                onFocus={()=>setShowProjects(true)}
                onBlur={()=>setTimeout(()=>setShowProjects(false),150)}
                placeholder={clientProjects.length>0?'Selecciona o escribe nuevo proyecto...':'Escribe el nombre del proyecto...'}
              />
              {showProjects&&clientProjects.length>0&&(
                <div style={{position:'absolute',top:'100%',left:0,right:0,background:'#fff',border:`1px solid ${C.border}`,borderRadius:8,boxShadow:'0 4px 16px rgba(0,0,0,.10)',zIndex:100,marginTop:4,maxHeight:180,overflowY:'auto'}}>
                  {clientProjects.filter(p=>!f.project||p.toLowerCase().includes(f.project.toLowerCase())).map((p,i)=>(
                    <div key={i} onMouseDown={()=>up('project',p)}
                      style={{padding:'9px 14px',cursor:'pointer',borderBottom:`1px solid ${C.border}`,fontSize:13,color:C.text}}
                      onMouseEnter={e=>e.currentTarget.style.background='#F0F4F6'}
                      onMouseLeave={e=>e.currentTarget.style.background='#fff'}>
                      {p}
                    </div>
                  ))}
                  <div style={{padding:'7px 14px',fontSize:11,color:C.muted,fontStyle:'italic',borderTop:`1px solid ${C.border}`}}>
                    O escribe un proyecto nuevo
                  </div>
                </div>
              )}
            </div>
          </Fld>

          <Fld label='Subproyecto (opcional)'>
            <div style={{position:'relative'}}>
              <Inp
                value={f.subproject||''}
                onChange={e=>up('subproject',e.target.value)}
                onFocus={()=>setShowSubprojects(true)}
                onBlur={()=>setTimeout(()=>setShowSubprojects(false),150)}
                placeholder={clientSubprojects.length>0?'Selecciona o escribe subproyecto...':'Ej: Contrato arriendo, Juicio laboral...'}
              />
              {showSubprojects&&clientSubprojects.length>0&&(
                <div style={{position:'absolute',top:'100%',left:0,right:0,background:'#fff',border:`1px solid ${C.border}`,borderRadius:8,boxShadow:'0 4px 16px rgba(0,0,0,.10)',zIndex:100,marginTop:4,maxHeight:180,overflowY:'auto'}}>
                  {clientSubprojects.filter(p=>!f.subproject||p.toLowerCase().includes(f.subproject.toLowerCase())).map((p,i)=>(
                    <div key={i} onMouseDown={()=>up('subproject',p)}
                      style={{padding:'9px 14px',cursor:'pointer',borderBottom:`1px solid ${C.border}`,fontSize:13,color:C.text}}
                      onMouseEnter={e=>e.currentTarget.style.background='#F0F4F6'}
                      onMouseLeave={e=>e.currentTarget.style.background='#fff'}>
                      {p}
                    </div>
                  ))}
                  <div style={{padding:'7px 14px',fontSize:11,color:C.muted,fontStyle:'italic',borderTop:`1px solid ${C.border}`}}>
                    O escribe un subproyecto nuevo
                  </div>
                </div>
              )}
            </div>
          </Fld>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10}}>
            <Fld label='Responsable'><Sel value={f.who} onChange={e=>up('who',e.target.value)} options={WHO}/></Fld>
            <Fld label='Plazo'><Inp type='date' value={f.due} onChange={e=>up('due',e.target.value)}/></Fld>
          </div>
        </>
      )}

      <div style={{display:'flex',gap:8,marginTop:4}}>
        <button onClick={onClose} style={{flex:1,padding:11,borderRadius:10,border:`1px solid ${C.border}`,background:'transparent',color:C.muted,fontSize:13,fontWeight:600,cursor:'pointer'}}>Cancelar</button>
        <button disabled={saving||!selectedClient||!f.title.trim()} onClick={()=>onSave({...f,client_id:selectedClient.id,project:f.project||null,subproject:f.subproject||null})}
          style={{flex:2,padding:11,borderRadius:10,border:'none',background:C.accent,color:'#fff',fontSize:13,fontWeight:700,cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center',gap:8,opacity:(!selectedClient||!f.title.trim())?.6:1}}>
          {saving?<Spin/>:null}{saving?'Guardando...':'Guardar tarea'}
        </button>
      </div>
    </>
  )
}

function ClientFicha({client,clients,sales,billing,expenses,tasks,clientEntities,onEdit,onClose,onAddTask,onAddGasto,onAddFondo,onAddSale,onAddBilling,onRendicion}) {
  const clientSales = sales.filter(s=>s.client_id===client.id)
  const clientBilling = billing.filter(b=>b.client_id===client.id)
  const clientExpenses = expenses.filter(e=>e.client_id===client.id)
  const clientTasks = tasks.filter(t=>t.client_id===client.id&&t.status!=='Completado')

  const vendidoUF = clientSales.reduce((a,s)=>a+(parseFloat(s.amount_uf)||0),0)
  const facturado = clientBilling.reduce((a,b)=>a+(b.amount||0),0)
  const cobrado = clientBilling.filter(b=>b.status==='Pagado').reduce((a,b)=>a+(b.amount||0),0)
  const porCobrar = clientBilling.filter(b=>['Pendiente','Vencido'].includes(b.status))
  const totalPorCobrar = porCobrar.reduce((a,b)=>a+(b.amount||0),0)
  const fondos = clientExpenses.filter(e=>e.type==='fondo').reduce((a,e)=>a+e.amount,0)
  const gastos = clientExpenses.filter(e=>e.type==='gasto').reduce((a,e)=>a+e.amount,0)
  const saldoFondos = fondos - gastos

  // Tareas agrupadas por proyecto
  const taskGroups = {}
  clientTasks.forEach(t=>{ const k=t.project||'__none__'; if(!taskGroups[k])taskGroups[k]=[]; taskGroups[k].push(t) })

  const CATS = {'Notaria':'#E3EEF3','CBR':'#F2E9DE','Diario Oficial':'#ECE6F5','Fondo':'#E4F1EA','Otro':'#ECECEC'}

  return (
    <div style={{paddingBottom:100}}>
      {/* Header */}
      <div style={{padding:'20px 20px 12px',position:'sticky',top:0,background:C.bg,zIndex:10,borderBottom:`1px solid ${C.border}`}}>
        <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:4}}>
          <button onClick={onClose} style={{background:'none',border:'none',color:C.muted,cursor:'pointer',fontSize:20,lineHeight:1,padding:'0 4px 0 0'}}>←</button>
          <div style={{flex:1,minWidth:0}}>
            <div style={{fontSize:18,fontWeight:700,color:C.text,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{client.name}</div>
            <div style={{fontSize:11,color:C.muted}}>{client.type}{client.status==='Terminado'?' · Terminado':''}</div>
          </div>
          <button onClick={()=>onEdit(client)} style={{padding:'6px 12px',borderRadius:8,border:`1px solid ${C.border}`,background:'#fff',color:C.text,fontSize:12,fontWeight:600,cursor:'pointer'}}>✎ Editar</button>
        </div>
      </div>

      <div style={{padding:'16px 20px 0'}}>

        {/* Razones sociales vinculadas */}
        {(()=>{
          const entities = (clientEntities||[]).filter(e=>e.client_id===client.id)
          if(!entities.length) return null
          return (
            <div style={{marginBottom:16,padding:'10px 14px',borderRadius:10,background:'#F7F7F7',border:`1px solid ${C.border}`}}>
              <div style={{fontSize:10,color:C.muted,textTransform:'uppercase',letterSpacing:.5,fontWeight:600,marginBottom:8}}>Razones sociales facturadas</div>
              {entities.map(e=>(
                <div key={e.id} style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'4px 0',borderBottom:`1px solid ${C.border}`}}>
                  <div style={{fontSize:12,fontWeight:500,color:C.text}}>{e.name||'—'}</div>
                  <div style={{fontSize:11,color:C.muted,fontFamily:'monospace'}}>{e.rut}</div>
                </div>
              ))}
            </div>
          )
        })()}

        {/* Resumen financiero */}
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8,marginBottom:20}}>
          {[
            ['Vendido',vendidoUF>0?fmtUF(vendidoUF):'—','#E3EEF3',C.accent],
            ['Por cobrar',totalPorCobrar>0?fmt(totalPorCobrar):'$0',totalPorCobrar>0?'#FBE9E7':'#F7F7F7',totalPorCobrar>0?C.overdue:C.muted],
            ['Cobrado',fmt(cobrado),'#E4F1EA',C.normal],
            ['Saldo fondos',fmt(saldoFondos),saldoFondos<0?'#FBE9E7':'#E4F1EA',saldoFondos<0?C.overdue:C.normal],
          ].map(([l,v,bg,col])=>(
            <div key={l} style={{background:bg,borderRadius:10,padding:'10px 12px',border:`1px solid ${C.border}`}}>
              <div style={{fontSize:10,color:C.muted,marginBottom:3,textTransform:'uppercase',letterSpacing:.4,fontWeight:600}}>{l}</div>
              <div style={{fontSize:14,fontWeight:700,color:col}}>{v}</div>
            </div>
          ))}
        </div>

        {/* Ventas */}
        <div style={{marginBottom:20}}>
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:8}}>
            <div style={{fontSize:13,fontWeight:600,color:C.text}}>Ventas</div>
            <button onClick={onAddSale} style={{padding:'4px 10px',borderRadius:6,border:`1px solid ${C.accent}`,background:'transparent',color:C.accent,fontSize:11,fontWeight:600,cursor:'pointer'}}>+ Nueva</button>
          </div>
          {clientSales.length===0&&<div style={{fontSize:12,color:C.muted,padding:'8px 0'}}>Sin ventas registradas</div>}
          {clientSales.map(s=>{
            const saleTasks = clientTasks.filter(t=>t.project===s.title)
            return (
            <div key={s.id} style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'8px 0',borderBottom:`1px solid ${C.border}`}}>
              <div style={{minWidth:0,flex:1}}>
                <div style={{fontSize:13,fontWeight:500,color:C.text,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{s.title}</div>
                <div style={{display:'flex',gap:6,marginTop:2,alignItems:'center'}}>
                  <AreaChip area={s.area}/>
                  <span style={{fontSize:10,color:C.muted}}>{s.year}</span>
                  <Pill label={s.status} bg={s.status==='Activo'?C.accent:s.status==='Terminado'?C.done:'#C77F18'} small/>
                  {saleTasks.length>0&&<span style={{fontSize:10,color:C.muted}}>{saleTasks.length} tarea{saleTasks.length!==1?'s':''}</span>}
                </div>
              </div>
              {s.amount_uf>0&&<div style={{fontSize:13,fontWeight:700,color:C.accent,flexShrink:0,marginLeft:12}}>{fmtUF(s.amount_uf)}</div>}
            </div>
          )})}
        </div>

        {/* Cobros pendientes */}
        {porCobrar.length>0&&(
          <div style={{marginBottom:20}}>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:8}}>
              <div style={{fontSize:13,fontWeight:600,color:C.text}}>Cobros pendientes</div>
              <button onClick={onAddBilling} style={{padding:'4px 10px',borderRadius:6,border:`1px solid ${C.accent}`,background:'transparent',color:C.accent,fontSize:11,fontWeight:600,cursor:'pointer'}}>+ Nuevo</button>
            </div>
            {(()=>{
              const sorted = [...porCobrar].sort((a,b)=>{const ra=(a.receptor_name||'').toLowerCase(),rb=(b.receptor_name||'').toLowerCase();if(ra!==rb)return ra.localeCompare(rb,'es');return new Date(a.issued_at||0)-new Date(b.issued_at||0)})
              const groups = []
              sorted.forEach(b=>{
                const key = b.receptor_name||'Sin razón social'
                const g = groups.find(g=>g.name===key)
                if(g) g.items.push(b)
                else groups.push({name:key, rut:b.receptor_rut||null, items:[b]})
              })
              return groups.map(g=>(
                <div key={g.name} style={{marginBottom:8}}>
                  <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'6px 0',borderBottom:`2px solid ${C.accent}`}}>
                    <div style={{fontSize:11,fontWeight:700,color:C.accent,textTransform:'uppercase',letterSpacing:.3}}>{g.name}{g.rut?` · ${g.rut}`:''}</div>
                    <div style={{fontSize:11,fontWeight:700,color:C.accent}}>{fmt(g.items.reduce((a,b)=>a+(b.amount||0),0))}</div>
                  </div>
                  {g.items.map(b=>(
                    <div key={b.id} style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'8px 0',borderBottom:`1px solid ${C.border}`}}>
                      <div style={{minWidth:0,flex:1}}>
                        <div style={{fontSize:13,fontWeight:500,color:C.text,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{b.concept||'—'}</div>
                        <div style={{fontSize:11,color:C.muted,display:'flex',gap:6,marginTop:2}}>
                          <span>{b.invoice_no||'—'}</span>
                          <span>·</span>
                          <DaysBadge due={b.due} status={b.status}/>
                        </div>
                      </div>
                      <div style={{fontSize:13,fontWeight:700,color:b.status==='Vencido'?C.overdue:C.text,flexShrink:0,marginLeft:12}}>{fmt(b.amount)}</div>
                    </div>
                  ))}
                </div>
              ))
            })()}
          </div>
        )}

        {/* Gastos y fondos */}
        <div style={{marginBottom:20}}>
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:8}}>
            <div style={{fontSize:13,fontWeight:600,color:C.text}}>Gastos y Fondos</div>
            <div style={{display:'flex',gap:6}}>
              <button onClick={onAddFondo} style={{padding:'4px 10px',borderRadius:6,border:`1px solid ${C.border}`,background:'#fff',color:C.normal,fontSize:11,fontWeight:600,cursor:'pointer'}}>+ Fondo</button>
              <button onClick={onAddGasto} style={{padding:'4px 10px',borderRadius:6,border:`1px solid ${C.accent}`,background:'transparent',color:C.accent,fontSize:11,fontWeight:600,cursor:'pointer'}}>+ Gasto</button>
            </div>
          </div>
          {clientExpenses.length===0&&<div style={{fontSize:12,color:C.muted,padding:'8px 0'}}>Sin movimientos</div>}
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:8,marginBottom:10}}>
            <div style={{background:'#E4F1EA',borderRadius:8,padding:'8px 10px'}}>
              <div style={{fontSize:10,color:C.muted,marginBottom:2}}>FONDOS</div>
              <div style={{fontSize:12,fontWeight:700,color:C.normal}}>{fmt(fondos)}</div>
            </div>
            <div style={{background:'#FBE9E7',borderRadius:8,padding:'8px 10px'}}>
              <div style={{fontSize:10,color:C.muted,marginBottom:2}}>GASTOS</div>
              <div style={{fontSize:12,fontWeight:700,color:C.overdue}}>{fmt(gastos)}</div>
            </div>
            <div style={{background:saldoFondos<0?'#FBE9E7':'#E4F1EA',borderRadius:8,padding:'8px 10px'}}>
              <div style={{fontSize:10,color:C.muted,marginBottom:2}}>SALDO</div>
              <div style={{fontSize:12,fontWeight:700,color:saldoFondos<0?C.overdue:C.normal}}>{fmt(saldoFondos)}</div>
            </div>
          </div>
          {clientExpenses.slice(0,5).map(e=>{
            const isFondo=e.type==='fondo'
            const catBg=CATS[e.category]||CATS['Otro']
            return (
              <div key={e.id} style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'7px 0',borderBottom:`1px solid ${C.border}`}}>
                <div style={{minWidth:0,flex:1,display:'flex',gap:6,alignItems:'center'}}>
                  {!isFondo&&e.category&&<span style={{fontSize:10,padding:'1px 6px',borderRadius:3,background:catBg,color:'#56616B',fontWeight:600,flexShrink:0}}>{e.category}</span>}
                  {isFondo&&<span style={{fontSize:10,padding:'1px 6px',borderRadius:3,background:'#E4F1EA',color:C.normal,fontWeight:600,flexShrink:0}}>Fondo</span>}
                  <span style={{fontSize:12,color:C.text,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{e.concept||'—'}</span>
                </div>
                <div style={{fontSize:12,fontWeight:600,color:isFondo?C.normal:C.overdue,flexShrink:0,marginLeft:8}}>{isFondo?'+':'-'}{fmt(e.amount)}</div>
              </div>
            )
          })}
          {clientExpenses.length>5&&<div style={{fontSize:11,color:C.muted,textAlign:'center',padding:'8px 0'}}>+{clientExpenses.length-5} más en Gastos y Fondos</div>}
          {clientExpenses.length>0&&(
            <button onClick={()=>onRendicion(client)} style={{marginTop:8,width:'100%',padding:'8px',borderRadius:8,border:`1px solid ${C.border}`,background:'#fff',color:C.accent,fontSize:12,fontWeight:600,cursor:'pointer'}}>↓ Rendir fondos</button>
          )}
        </div>

        {/* Proyectos y Tareas */}
        <div style={{marginBottom:20}}>
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:12}}>
            <div style={{fontSize:13,fontWeight:600,color:C.text}}>Proyectos y Tareas</div>
            <button onClick={onAddTask} style={{padding:'4px 10px',borderRadius:6,border:`1px solid ${C.accent}`,background:'transparent',color:C.accent,fontSize:11,fontWeight:600,cursor:'pointer'}}>+ Tarea</button>
          </div>
          {clientTasks.length===0&&<div style={{fontSize:12,color:C.muted,padding:'8px 0'}}>Sin tareas activas</div>}

          {/* Proyectos nombrados */}
          {Object.keys(taskGroups).filter(k=>k!=='__none__').map(key=>{
            const taskList = taskGroups[key]
            const overdueN = taskList.filter(t=>urgency(t.due,t.status)==='overdue').length
            const urgentN = taskList.filter(t=>urgency(t.due,t.status)==='urgent').length
            return (
              <div key={key} style={{marginBottom:12,borderRadius:10,border:`1px solid ${C.border}`,overflow:'hidden',background:C.card}}>
                <div style={{padding:'10px 14px',background:'#F0F5F7',borderBottom:`1px solid ${C.border}`,display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                  <div style={{fontSize:12,fontWeight:700,color:C.accent,textTransform:'uppercase',letterSpacing:.5}}>{key}</div>
                  <div style={{display:'flex',gap:6,alignItems:'center'}}>
                    {overdueN>0&&<span style={{fontSize:10,fontWeight:700,color:'#fff',background:C.overdue,borderRadius:10,padding:'1px 7px'}}>{overdueN} venc.</span>}
                    {urgentN>0&&overdueN===0&&<span style={{fontSize:10,fontWeight:700,color:'#fff',background:C.soon,borderRadius:10,padding:'1px 7px'}}>{urgentN} urg.</span>}
                    <span style={{fontSize:11,color:C.muted}}>{taskList.length} tarea{taskList.length!==1?'s':''}</span>
                  </div>
                </div>
                {taskList.map(t=>(
                  <div key={t.id} style={{display:'flex',gap:8,alignItems:'flex-start',padding:'9px 14px',borderBottom:`1px solid ${C.border}`}}>
                    <div style={{width:7,height:7,borderRadius:'50%',background:urgencyColor(t.due,t.status),flexShrink:0,marginTop:4}}/>
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{fontSize:13,color:C.text,fontWeight:500}}>{t.title}</div>
                      <div style={{fontSize:11,color:C.muted,display:'flex',gap:6,marginTop:2}}>
                        <span>{t.who||'—'}</span>
                        {t.due&&<><span>·</span><DaysBadge due={t.due} status={t.status}/></>}
                        {t.note&&<><span>·</span><span style={{fontStyle:'italic',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{t.note}</span></>}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )
          })}

          {/* Tareas sin proyecto */}
          {taskGroups['__none__']&&(
            <div style={{marginBottom:10}}>
              <div style={{fontSize:11,color:C.muted,fontWeight:600,textTransform:'uppercase',letterSpacing:.5,marginBottom:6}}>Sin proyecto</div>
              {taskGroups['__none__'].map(t=>(
                <div key={t.id} style={{display:'flex',gap:8,alignItems:'flex-start',padding:'7px 0',borderBottom:`1px solid ${C.border}`}}>
                  <div style={{width:7,height:7,borderRadius:'50%',background:urgencyColor(t.due,t.status),flexShrink:0,marginTop:4}}/>
                  <div style={{flex:1,minWidth:0}}>
                    <div style={{fontSize:13,color:C.text,fontWeight:500}}>{t.title}</div>
                    <div style={{fontSize:11,color:C.muted,display:'flex',gap:6,marginTop:2}}>
                      <span>{t.who||'—'}</span>
                      {t.due&&<><span>·</span><DaysBadge due={t.due} status={t.status}/></>}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

      </div>
    </div>
  )
}

function ClientsView({clients,sales,billing,expenses,tasks,clientEntities,onToggleStatus,onEdit,onAdd,onAddTask,onAddGasto,onAddFondo,onAddSale,onAddBilling,onImportDrive}) {
  const [sFilter,setSFilter] = useState('Activo')
  const [q,setQ] = useState('')
  const [selected,setSelected] = useState(null)
  const [rendicionClient,setRendicionClient] = useState(null)

  // Actualizar selected cuando cambian los datos
  useEffect(()=>{ if(selected) setSelected(clients.find(c=>c.id===selected.id)||null) },[clients])

  const activeN=clients.filter(c=>(c.status||'Activo')==='Activo').length
  const endedN=clients.filter(c=>c.status==='Terminado').length
  const cl = useMemo(()=>{
    let base = clients
    if(sFilter==='Activo') base=base.filter(c=>(c.status||'Activo')==='Activo')
    else if(sFilter==='Terminado') base=base.filter(c=>c.status==='Terminado')
    if(q.trim()) base=base.filter(c=>c.name.toLowerCase().includes(q.toLowerCase()))
    return base
  },[clients,sFilter,q])
  const balances = useMemo(()=>{
    const m={}; expenses.forEach(e=>{ m[e.client_id]=(m[e.client_id]||0)+(e.type==='fondo'?e.amount:-e.amount) }); return m
  },[expenses])

  if(selected) return (
    <>
      <ClientFicha
        client={selected}
        clients={clients}
        sales={sales}
        billing={billing}
        expenses={expenses}
        tasks={tasks}
        clientEntities={clientEntities}
        onEdit={c=>{onEdit(c)}}
        onClose={()=>setSelected(null)}
        onAddTask={()=>onAddTask(selected)}
        onAddGasto={()=>onAddGasto(selected)}
        onAddFondo={()=>onAddFondo(selected)}
        onAddSale={()=>onAddSale(selected)}
        onAddBilling={()=>onAddBilling(selected)}
        onRendicion={c=>setRendicionClient(c)}
      />
      {rendicionClient&&<Modal title={`Rendición — ${rendicionClient.name}`} onClose={()=>setRendicionClient(null)}><RendicionModal client={rendicionClient} expenses={expenses} onClose={()=>setRendicionClient(null)}/></Modal>}
    </>
  )

  return (
    <div>
      <div style={{padding:'20px 20px 0',position:'sticky',top:0,background:C.bg,zIndex:10}}>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
          <div style={{fontSize:20,fontWeight:600,color:C.text,fontFamily:"'DM Sans',sans-serif",letterSpacing:-.4}}>Clientes</div>
          <div style={{display:'flex',gap:6}}>
            <button onClick={onImportDrive} style={{padding:'6px 12px',borderRadius:8,border:`1px solid ${C.accent}`,background:'transparent',color:C.accent,fontSize:12,fontWeight:600,cursor:'pointer'}}>↓ Drive</button>
            <button onClick={onAdd} style={{padding:'6px 12px',borderRadius:8,border:`1px solid ${C.border}`,background:'#fff',color:C.text,fontSize:12,fontWeight:600,cursor:'pointer'}}>+ Cliente</button>
            <button onClick={()=>onAddTask(null)} style={{padding:'6px 14px',borderRadius:8,border:'none',background:C.accent,color:'#fff',fontSize:12,fontWeight:600,cursor:'pointer'}}>+ Tarea</button>
          </div>
        </div>
        <div style={{fontSize:12,color:C.muted,margin:'4px 0 10px'}}>{cl.length} {cl.length===1?'cliente':'clientes'}</div>
        <Inp value={q} onChange={e=>setQ(e.target.value)} placeholder='Buscar cliente...' style={{marginBottom:8}}/>
        <div style={{display:'flex',gap:6,marginBottom:4}}>
          {[['Activo',`Activos (${activeN})`],['Terminado',`Terminados (${endedN})`],['all','Todos']].map(([v,l])=>(
            <button key={v} onClick={()=>setSFilter(v)} style={{flex:1,padding:'7px 0',borderRadius:8,border:`1px solid ${sFilter===v?C.accent:C.border}`,background:sFilter===v?'#E6EEF1':'transparent',color:sFilter===v?C.accent:C.muted,fontSize:12,fontWeight:600,cursor:'pointer'}}>{l}</button>
          ))}
        </div>
      </div>
      <div style={{padding:'10px 20px 100px'}}>
        {cl.length===0&&<div style={{color:C.muted,textAlign:'center',padding:40}}>Sin clientes</div>}
        {cl.map(c=>{
          const ended=c.status==='Terminado'
          const activeSales=sales.filter(s=>s.client_id===c.id&&s.status==='Activo').length
          const cp=billing.filter(b=>b.client_id===c.id&&['Pendiente','Vencido'].includes(b.status)).reduce((s,b)=>s+(b.amount||0),0)
          const hasOverdue=billing.some(b=>b.client_id===c.id&&b.status==='Vencido')
          const balance=balances[c.id]||0
          return (
            <div key={c.id} onClick={()=>setSelected(c)} style={{background:C.card,borderRadius:10,padding:'13px 16px',marginBottom:8,border:`1px solid ${C.border}`,borderLeft:`3px solid ${ended?C.done:hasOverdue?C.overdue:C.accent}`,opacity:ended?.7:1,cursor:'pointer'}}
              onMouseEnter={e=>e.currentTarget.style.boxShadow='0 2px 12px rgba(0,0,0,.09)'}
              onMouseLeave={e=>e.currentTarget.style.boxShadow='none'}>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',gap:8,marginBottom:4}}>
                <div style={{minWidth:0}}>
                  <div style={{fontSize:14,fontWeight:600,color:C.text,marginBottom:2}}>{c.name}</div>
                  <div style={{fontSize:11,color:C.muted}}>{c.type}{c.rut?` · ${c.rut}`:''}</div>
                </div>
                <button onClick={ev=>{ev.stopPropagation();onToggleStatus(c)}} style={{flexShrink:0,padding:'4px 10px',borderRadius:20,border:`1px solid ${ended?C.border:C.normal}`,background:ended?'#ECECEC':'transparent',color:ended?C.muted:C.normal,fontSize:11,fontWeight:700,cursor:'pointer',whiteSpace:'nowrap'}}>{ended?'Reactivar':'Terminar'}</button>
              </div>
              <div style={{display:'flex',gap:12,fontSize:11,flexWrap:'wrap'}}>
                {!ended&&<span style={{color:C.accent}}>{activeSales} ventas activas</span>}
                {cp>0&&<span style={{color:hasOverdue?C.overdue:C.soon,fontWeight:600}}>{fmt(cp)} por cobrar</span>}
                {balance!==0&&<span style={{color:balance<0?C.overdue:C.normal,fontWeight:600}}>Fondos: {fmt(balance)}</span>}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function EntitiesEditor({clientId}) {
  const [list,setList]=useState(null)
  const [allEntities,setAll]=useState([])
  const [name,setName]=useState('')
  const [rut,setRut]=useState('')
  const [suggestions,setSugg]=useState([])
  const [showSugg,setShowSugg]=useState(false)
  const [edit,setEdit]=useState(null)
  const [busy,setBusy]=useState(false)
  const sortN=arr=>[...arr].sort((a,b)=>(a.name||'').localeCompare(b.name||'','es'))
  useEffect(()=>{
    let ok=true
    getClientEntities(clientId).then(d=>ok&&setList(d)).catch(()=>ok&&setList([]))
    getAllEntities().then(d=>ok&&setAll(d)).catch(()=>{})
    return ()=>{ok=false}
  },[clientId])
  const handleNameChange=val=>{
    setName(val); if(val.trim().length<2){setSugg([]);setShowSugg(false);return}
    const m=allEntities.filter(e=>e.name.toLowerCase().includes(val.toLowerCase())).slice(0,6)
    setSugg(m);setShowSugg(m.length>0)
  }
  const add=async()=>{
    if(!name.trim()) return; setBusy(true)
    try {
      const saved=await upsertClientEntity({client_id:clientId,name:name.trim(),rut:rut.trim()||null})
      setList(p=>sortN([...(p||[]),saved]));setName('');setRut('');setSugg([]);setShowSugg(false)
    } catch(e){alert('Error: '+e.message)}
    setBusy(false)
  }
  const saveEdit=async()=>{
    if(!edit.name.trim()) return; setBusy(true)
    try {
      const saved=await upsertClientEntity({id:edit.id,client_id:clientId,name:edit.name.trim(),rut:edit.rut?.trim()||null})
      setList(p=>sortN(p.map(x=>x.id===saved.id?saved:x)));setEdit(null)
    } catch(e){alert('Error: '+e.message)}
    setBusy(false)
  }
  const del=async id=>{
    if(!confirm('Eliminar?')) return
    try{await deleteClientEntity(id);setList(p=>p.filter(x=>x.id!==id))}catch(e){alert(e.message)}
  }
  const inS={padding:'8px 10px',borderRadius:7,border:`1px solid ${C.border}`,background:'#fff',color:C.text,fontSize:13,boxSizing:'border-box',outline:'none'}
  const iconBtn=col=>({width:30,height:30,flexShrink:0,borderRadius:7,border:`1px solid ${C.border}`,background:'#fff',color:col,fontSize:14,cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center'})
  return (
    <div style={{marginBottom:14,padding:14,borderRadius:10,border:`1px solid ${C.border}`,background:'#FAFAFA'}}>
      <Lbl>Entidades facturables</Lbl>
      {list===null&&<div style={{fontSize:12,color:C.muted}}>Cargando...</div>}
      {list?.map(e=>(
        <div key={e.id} style={{display:'flex',gap:6,alignItems:'center',marginBottom:6}}>
          {edit?.id===e.id?(
            <>
              <input value={edit.name} onChange={ev=>setEdit({...edit,name:ev.target.value})} style={{...inS,flex:1,minWidth:0}}/>
              <input value={edit.rut||''} onChange={ev=>setEdit({...edit,rut:ev.target.value})} style={{...inS,width:110,flexShrink:0}}/>
              <button onClick={saveEdit} disabled={busy} style={iconBtn(C.normal)}>ok</button>
              <button onClick={()=>setEdit(null)} style={iconBtn(C.muted)}>x</button>
            </>
          ):(
            <>
              <div style={{flex:1,minWidth:0}}>
                <div style={{fontSize:13,color:C.text,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{e.name}</div>
                {e.rut&&<div style={{fontSize:11,color:C.muted}}>{e.rut}</div>}
              </div>
              <button onClick={()=>setEdit({id:e.id,name:e.name,rut:e.rut})} style={iconBtn(C.accent)}>ed</button>
              <button onClick={()=>del(e.id)} style={iconBtn(C.overdue)}>x</button>
            </>
          )}
        </div>
      ))}
      <div style={{marginTop:8}}>
        <div style={{display:'flex',gap:6,position:'relative'}}>
          <div style={{flex:1,minWidth:0,position:'relative'}}>
            <input value={name} onChange={e=>handleNameChange(e.target.value)} onBlur={()=>setTimeout(()=>setShowSugg(false),150)} placeholder='Razon social...' style={{...inS,width:'100%'}}/>
            {showSugg&&suggestions.length>0&&(
              <div style={{position:'absolute',top:'100%',left:0,right:0,background:'#fff',border:`1px solid ${C.border}`,borderRadius:7,boxShadow:'0 4px 16px rgba(0,0,0,.10)',zIndex:100,maxHeight:200,overflowY:'auto',marginTop:2}}>
                {suggestions.map((s,i)=>(
                  <div key={i} onMouseDown={()=>{setName(s.name);setRut(s.rut||'');setSugg([]);setShowSugg(false)}} style={{padding:'8px 12px',cursor:'pointer',borderBottom:`1px solid ${C.border}`,fontSize:13}}
                    onMouseEnter={e=>e.currentTarget.style.background='#F0F4F6'}
                    onMouseLeave={e=>e.currentTarget.style.background='#fff'}>
                    <div style={{fontWeight:500}}>{s.name}</div>
                    {s.rut&&<div style={{fontSize:11,color:C.muted}}>{s.rut}</div>}
                  </div>
                ))}
              </div>
            )}
          </div>
          <input value={rut} onChange={e=>setRut(e.target.value)} placeholder='RUT' style={{...inS,width:110,flexShrink:0}}/>
          <button onClick={add} disabled={busy||!name.trim()} style={{padding:'0 12px',borderRadius:7,border:'none',background:C.accent,color:'#fff',fontSize:13,fontWeight:600,cursor:name.trim()?'pointer':'not-allowed',opacity:name.trim()?1:.6,flexShrink:0}}>+</button>
        </div>
      </div>
    </div>
  )
}

// ─── TASKS EDITOR (dentro de ficha cliente) ───────────────────────────────────
function TasksEditor({clientId,sales}) {
  const [tasks,setTasks] = useState(null)
  const [form,setForm] = useState(null)
  const [busy,setBusy] = useState(false)
  const [showProjects,setShowProjects] = useState(false)
  const [showSubprojects,setShowSubprojects] = useState(false)
  const WHO = ['Cristóbal','Martín','Erasmo','Rodrigo','Martina']

  useEffect(()=>{
    let ok=true
    supabase.from('tasks').select('*').eq('client_id',clientId).order('due',{ascending:true,nullsFirst:false})
      .then(({data})=>ok&&setTasks(data||[]))
    return ()=>{ok=false}
  },[clientId])

  const existingProjects = useMemo(()=>{
    const fromTasks = [...new Set((tasks||[]).filter(t=>t.project).map(t=>t.project))]
    const fromSales = (sales||[]).filter(s=>s.client_id===clientId&&s.title).map(s=>s.title)
    return [...new Set([...fromSales,...fromTasks])].sort()
  },[tasks,sales,clientId])

  const save = async()=>{
    if(!form.title?.trim()) return
    setBusy(true)
    try{
      const p={...form,client_id:clientId,sale_id:form.sale_id||null,project:form.project||null}
      const{data,error}=await supabase.from('tasks').upsert(p).select().single()
      if(error)throw error
      setTasks(p=>form.id?p.map(x=>x.id===data.id?data:x):[...p,data])
      // Alerta email solo en tarea NUEVA con quien asignado
      if(!form.id && data.who){
        const client=clients?.find(c=>c.id===data.client_id)
        fetch('https://kibuwhtpoxrnfowfdolu.supabase.co/functions/v1/notify-task',{
          method:'POST',
          headers:{'Content-Type':'application/json','Authorization':'Bearer '+supabase.supabaseKey},
          body:JSON.stringify({task:{...data,client_name:client?.name||''},assignedBy:'el estudio'})
        }).catch(()=>{})
      }
      setForm(null)
    }catch(e){alert('Error: '+e.message)}
    setBusy(false)
  }

  const toggle = async(t)=>{
    const status=t.status==='Completado'?'Activo':'Completado'
    await supabase.from('tasks').update({status}).eq('id',t.id)
    setTasks(p=>p.map(x=>x.id===t.id?{...x,status}:x))
  }

  const del = async(id)=>{
    if(!confirm('Eliminar tarea?')) return
    await supabase.from('tasks').delete().eq('id',id)
    setTasks(p=>p.filter(x=>x.id!==id))
  }

  const active = tasks?.filter(t=>t.status!=='Completado')||[]
  const done   = tasks?.filter(t=>t.status==='Completado')||[]
  const grouped = {}
  active.forEach(t=>{ const k=t.project||'__none__'; if(!grouped[k])grouped[k]=[]; grouped[k].push(t) })

  return (
    <div style={{marginBottom:14,padding:14,borderRadius:10,border:`1px solid ${C.border}`,background:'#FAFAFA'}}>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:8}}>
        <Lbl>Tareas</Lbl>
        <button onClick={()=>setForm({title:'',who:'Cristóbal',due:'',status:'Activo',note:'',project:''})} style={{padding:'3px 10px',borderRadius:6,border:`1px solid ${C.accent}`,background:'transparent',color:C.accent,fontSize:11,fontWeight:600,cursor:'pointer'}}>+ Agregar</button>
      </div>
      {tasks===null&&<div style={{fontSize:12,color:C.muted}}>Cargando...</div>}
      {tasks?.length===0&&!form&&<div style={{fontSize:12,color:C.muted}}>Sin tareas.</div>}

      {form&&(
        <div style={{background:'#fff',borderRadius:8,padding:12,marginBottom:10,border:`1px solid ${C.border}`}}>
          <input value={form.title||''} onChange={e=>setForm(p=>({...p,title:e.target.value}))} placeholder='Descripción...' style={{width:'100%',padding:'8px 10px',borderRadius:7,border:`1px solid ${C.border}`,fontSize:13,marginBottom:8,boxSizing:'border-box'}}/>
          <div style={{position:'relative',marginBottom:8}}>
            <input value={form.project||''} onChange={e=>setForm(p=>({...p,project:e.target.value}))} onFocus={()=>setShowProjects(true)} onBlur={()=>setTimeout(()=>setShowProjects(false),150)} placeholder='Proyecto (opcional)...' style={{width:'100%',padding:'8px 10px',borderRadius:7,border:`1px solid ${C.border}`,fontSize:13,boxSizing:'border-box'}}/>
            {showProjects&&existingProjects.length>0&&(
              <div style={{position:'absolute',top:'100%',left:0,right:0,background:'#fff',border:`1px solid ${C.border}`,borderRadius:7,boxShadow:'0 4px 12px rgba(0,0,0,.10)',zIndex:100,marginTop:2,maxHeight:150,overflowY:'auto'}}>
                {existingProjects.filter(p=>!form.project||p.toLowerCase().includes(form.project.toLowerCase())).map((p,i)=>(
                  <div key={i} onMouseDown={()=>setForm(f=>({...f,project:p}))} style={{padding:'8px 12px',cursor:'pointer',borderBottom:`1px solid ${C.border}`,fontSize:12,color:C.text}} onMouseEnter={e=>e.currentTarget.style.background='#F0F4F6'} onMouseLeave={e=>e.currentTarget.style.background='#fff'}>{p}</div>
                ))}
              </div>
            )}
          </div>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8,marginBottom:8}}>
            <select value={form.who||'Cristóbal'} onChange={e=>setForm(p=>({...p,who:e.target.value}))} style={{padding:'7px 10px',borderRadius:7,border:`1px solid ${C.border}`,fontSize:12,background:'#F7F7F7'}}>{WHO.map(w=><option key={w} value={w}>{w}</option>)}</select>
            <input type='date' value={form.due||''} onChange={e=>setForm(p=>({...p,due:e.target.value}))} style={{padding:'7px 10px',borderRadius:7,border:`1px solid ${C.border}`,fontSize:12,background:'#F7F7F7'}}/>
          </div>
          <input value={form.note||''} onChange={e=>setForm(p=>({...p,note:e.target.value}))} placeholder='Nota (opcional)...' style={{width:'100%',padding:'7px 10px',borderRadius:7,border:`1px solid ${C.border}`,fontSize:12,marginBottom:8,boxSizing:'border-box'}}/>
          <div style={{display:'flex',gap:6}}>
            <button onClick={()=>setForm(null)} style={{flex:1,padding:'7px',borderRadius:7,border:`1px solid ${C.border}`,background:'transparent',color:C.muted,fontSize:12,cursor:'pointer'}}>Cancelar</button>
            <button onClick={save} disabled={busy||!form.title?.trim()} style={{flex:2,padding:'7px',borderRadius:7,border:'none',background:C.accent,color:'#fff',fontSize:12,fontWeight:600,cursor:'pointer'}}>{busy?'Guardando...':'Guardar'}</button>
          </div>
        </div>
      )}

      {Object.keys(grouped).map(key=>{
        const isProject = key!=='__none__'
        return (
          <div key={key} style={{marginBottom:10}}>
            {isProject&&<div style={{fontSize:11,fontWeight:600,color:C.accent,textTransform:'uppercase',letterSpacing:.5,marginBottom:4,paddingLeft:2}}>{key}</div>}
            {grouped[key].map(t=>(
              <div key={t.id} style={{display:'flex',gap:8,alignItems:'flex-start',padding:'8px 0',borderBottom:`1px solid ${C.border}`}}>
                <button onClick={()=>toggle(t)} style={{width:18,height:18,borderRadius:4,border:`2px solid ${C.accent}`,background:'transparent',cursor:'pointer',flexShrink:0,marginTop:1}}/>
                <div style={{flex:1,minWidth:0}}>
                  <div style={{fontSize:13,color:C.text,fontWeight:500}}>{t.title}</div>
                  <div style={{fontSize:11,color:C.muted,display:'flex',gap:6,flexWrap:'wrap',marginTop:2}}>
                    <span>{t.who||'—'}</span>
                    {t.due&&<><span>·</span><DaysBadge due={t.due} status={t.status}/></>}
                    {t.note&&<><span>·</span><span style={{overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',fontStyle:'italic'}}>{t.note}</span></>}
                  </div>
                </div>
                <button onClick={()=>setForm({...t})} style={{background:'none',border:'none',color:C.muted,fontSize:12,cursor:'pointer',flexShrink:0}}>ed</button>
                <button onClick={()=>del(t.id)} style={{background:'none',border:'none',color:C.overdue,fontSize:12,cursor:'pointer',flexShrink:0}}>x</button>
              </div>
            ))}
          </div>
        )
      })}

      {done.length>0&&(
        <div style={{marginTop:8}}>
          <div style={{fontSize:10,color:C.muted,fontWeight:600,textTransform:'uppercase',letterSpacing:.5,marginBottom:4}}>Completadas ({done.length})</div>
          {done.map(t=>(
            <div key={t.id} style={{display:'flex',gap:8,alignItems:'center',padding:'5px 0'}}>
              <button onClick={()=>toggle(t)} style={{width:18,height:18,borderRadius:4,border:`2px solid ${C.done}`,background:C.done,cursor:'pointer',flexShrink:0,fontSize:10,color:'#fff',display:'flex',alignItems:'center',justifyContent:'center'}}>v</button>
              <div style={{flex:1,fontSize:12,color:C.muted,textDecoration:'line-through',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{t.title}</div>
              <button onClick={()=>del(t.id)} style={{background:'none',border:'none',color:C.muted,fontSize:11,cursor:'pointer'}}>x</button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}


function ClientForm({client,onSave,onClose,onDelete,saving,sales}) {
  const [f,setF]=useState(client||{name:'',rut:'',type:'',email:'',phone:'',contact:'',erasmo:false,status:'Activo',ended_at:'',notes:''})
  const up=(k,v)=>setF(p=>({...p,[k]:v}))
  return (
    <>
      <Fld label='Nombre'><Inp value={f.name||''} onChange={e=>up('name',e.target.value)} placeholder='Nombre del cliente...'/></Fld>
      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10}}>
        <Fld label='RUT'><Inp value={f.rut||''} onChange={e=>up('rut',e.target.value)} placeholder='76.217.569-K'/></Fld>
        <Fld label='Tipo'><Sel value={f.type||''} onChange={e=>up('type',e.target.value)} options={['Corporativo','Tributario','Laboral']} placeholder='— Seleccionar —'/></Fld>
      </div>
      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10}}>
        <Fld label='Email'><Inp type='email' value={f.email||''} onChange={e=>up('email',e.target.value)} placeholder='correo@...'/></Fld>
        <Fld label='Telefono'><Inp value={f.phone||''} onChange={e=>up('phone',e.target.value)} placeholder='+56...'/></Fld>
      </div>
      <Fld label='Contacto'><Inp value={f.contact||''} onChange={e=>up('contact',e.target.value)} placeholder='Persona de contacto...'/></Fld>
      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10}}>
        <Fld label='Estado'><Sel value={f.status||'Activo'} onChange={e=>up('status',e.target.value)} options={['Activo','Terminado']}/></Fld>
        {f.status==='Terminado'&&<Fld label='Fecha termino'><Inp type='date' value={f.ended_at||''} onChange={e=>up('ended_at',e.target.value)}/></Fld>}
      </div>
      <Fld label='Cartera'>
        <button type='button' onClick={()=>up('erasmo',!f.erasmo)} style={{padding:'9px 14px',borderRadius:8,border:`1px solid ${f.erasmo?C.accent:C.border}`,background:f.erasmo?'#E6EEF1':'transparent',color:f.erasmo?C.accent:C.muted,fontSize:13,fontWeight:600,cursor:'pointer'}}>
          {f.erasmo?'Cliente de Erasmo':'Marcar como Erasmo'}
        </button>
      </Fld>
      <Fld label='Notas'><Txt value={f.notes||''} onChange={e=>up('notes',e.target.value)} placeholder='Contexto relevante...'/></Fld>
      {client?.id?<EntitiesEditor clientId={client.id}/>:<div style={{fontSize:11,color:C.muted,marginBottom:14}}>Guarda el cliente para agregar entidades facturables.</div>}
      {client?.id&&<TasksEditor clientId={client.id} sales={sales}/>}
      <div style={{display:'flex',gap:8,marginTop:4}}>
        {client?.id&&<button onClick={()=>onDelete(client.id)} style={{padding:'11px 14px',borderRadius:10,border:`1px solid ${C.overdue}`,background:'transparent',color:C.overdue,fontSize:13,fontWeight:600,cursor:'pointer'}}>Eliminar</button>}
        <button onClick={onClose} style={{flex:1,padding:11,borderRadius:10,border:`1px solid ${C.border}`,background:'transparent',color:C.muted,fontSize:13,fontWeight:600,cursor:'pointer'}}>Cancelar</button>
        <button disabled={saving||!f.name?.trim()} onClick={()=>onSave(f)} style={{flex:2,padding:11,borderRadius:10,border:'none',background:C.accent,color:'#fff',fontSize:13,fontWeight:700,cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center',gap:8,opacity:!f.name?.trim()?.6:1}}>
          {saving?<Spin/>:null}{saving?'Guardando...':'Guardar'}
        </button>
      </div>
    </>
  )
}

// ─── PARSER + DRIVE IMPORTER (sin cambios) ───────────────────────────────────
const MESES={enero:1,febrero:2,marzo:3,abril:4,mayo:5,junio:6,julio:7,agosto:8,septiembre:9,setiembre:9,octubre:10,noviembre:11,diciembre:12}
function parseInvoice(raw) {
  // pdfjs entrega texto plano sin saltos reales
  const t = raw.replace(/\r?\n/g,' ').replace(/\s{2,}/g,' ')
  // DEBUG temporal: ver el texto real extraido
  // Folio
  const folioM = t.match(/N[\xba\xb0o]?\s*(\d{3,7})/)
  const folio = folioM ? folioM[1] : null

  // Receptor
  const receptorM = t.match(/SE[N\u00d1]OR(?:\(ES\))?:?\s*(.+?)\s*R\.?U\.?T\.?:/)
  const cliente = receptorM ? receptorM[1].trim() : null

  // RUT receptor
  const rutZone = t.match(/SE[N\u00d1]OR(?:\(ES\))?:?.+?R\.?U\.?T\.?:?\s*([\d\.]{7,11}\s*[-\u2013]\s*[\dkK])/)
  const rut = rutZone ? rutZone[1].replace(/\s/g,'') : null

  // Fecha
  let issued_at = null
  const fechaM = t.match(/(\d{1,2})\s+de\s+(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre)\s+de[l]?\s+(\d{4})/i)
  if(fechaM) {
    const dia = parseInt(fechaM[1])
    const mes = MESES[fechaM[2].toLowerCase()]
    const anio = parseInt(fechaM[3])
    if(mes) issued_at = `${anio}-${String(mes).padStart(2,'0')}-${String(dia).padStart(2,'0')}`
  }

  // Glosa
  let concepto = null
  const gM = t.match(/Valor\s*[-\u2013]\s*(.+?)\s+1\s+[\d][\d\.]{3,}/)
  if(gM) concepto = gM[1].replace(/\s+/g,' ').trim()
  if(!concepto){const gM2 = t.match(/[-\u2013]\s+([A-Za-z\u00c0-\u00ff].{8,90}?)\s+1\s+[\d][\d\.]{3,}/);if(gM2) concepto = gM2[1].replace(/\s+/g,' ').trim()}

  // Total
  const totalM = t.match(/TOTAL\s*\$?\s*([\d\.]{4,12})/)
  const total = totalM ? parseInt(totalM[1].replace(/\./g,'')) : null

  return { folio, cliente, rut, issued_at, concepto, total }
}
const FACTURACION_ROOT='1GtcDmnq2FpGQlaZRETyOU4Zwf5MfCi7V'
const CLIENTES_ROOT='19JsFeh9icekmXMKyubkbLxfXVujmc3eh'
const CLIENTES_TERMINADOS_ROOT='1_wi0td0ib9QlBLjUvDkr6QzdLn1sPwGX'
async function driveGet(token,url){
  const fullUrl=url+(url.includes('?')?'&':'?')+'supportsAllDrives=true&includeItemsFromAllDrives=true'
  const r=await fetch(fullUrl,{headers:{Authorization:'Bearer '+token}})
  if(!r.ok) throw new Error('Drive API error '+r.status)
  return r.json()
}
function ClienteDriveImporter({clients,onImported,onClose}){
  const [step,setStep]=useState('loading')
  const [token,setToken]=useState(null)
  const [newClients,setNewClients]=useState([])
  const [terminados2024,setTerminados2024]=useState([])
  const [terminados2025,setTerminados2025]=useState([])
  const [selected,setSelected]=useState({})
  const [saving,setSaving]=useState(false)
  const [log,setLog]=useState([])
  const addLog=msg=>setLog(p=>[...p,msg])

  useEffect(()=>{init()},[])

  async function init(){
    setStep('loading')
    let t=localStorage.getItem('drive_token')
    if(!t){try{t=await getDriveToken()}catch(e){}}
    if(!t){setStep('notoken');return}
    setToken(t)
    try{
      // Clientes activos
      const resActivos=await driveGet(t,`https://www.googleapis.com/drive/v3/files?q='${CLIENTES_ROOT}'+in+parents+and+mimeType='application/vnd.google-apps.folder'+and+trashed=false&orderBy=name&fields=files(id,name)`)
      const activos=(resActivos.files||[]).filter(f=>!f.name.startsWith('1. CLIENTES'))
      const existingNames=clients.map(c=>c.name.toLowerCase().trim())
      const nuevos=activos.filter(f=>!existingNames.includes(f.name.toLowerCase().trim()))
      setNewClients(nuevos)

      // Clientes terminados - buscar subcarpetas 2024 y 2025
      const resTerminados=await driveGet(t,`https://www.googleapis.com/drive/v3/files?q='${CLIENTES_TERMINADOS_ROOT}'+in+parents+and+mimeType='application/vnd.google-apps.folder'+and+trashed=false&orderBy=name&fields=files(id,name)`)
      const yearFolders=resTerminados.files||[]

      for(const yf of yearFolders){
        const resYear=await driveGet(t,`https://www.googleapis.com/drive/v3/files?q='${yf.id}'+in+parents+and+mimeType='application/vnd.google-apps.folder'+and+trashed=false&orderBy=name&fields=files(id,name)`)
        const yearClients=(resYear.files||[]).filter(f=>!existingNames.includes(f.name.toLowerCase().trim()))
        if(yf.name.includes('2024')) setTerminados2024(yearClients)
        if(yf.name.includes('2025')) setTerminados2025(yearClients)
      }
      setStep('review')
    }catch(e){setStep('error');addLog('Error: '+e.message)}
  }

  const toggle=(id)=>setSelected(p=>({...p,[id]:!p[id]}))
  const toggleAll=(list)=>{
    const allSelected=list.every(f=>selected[f.id])
    const upd={...selected}
    list.forEach(f=>{upd[f.id]=!allSelected})
    setSelected(upd)
  }

  const saveSelected=async()=>{
    const toImport=[...newClients,...terminados2024,...terminados2025].filter(f=>selected[f.id])
    if(!toImport.length) return
    setSaving(true);setStep('saving')
    let imported=0
    for(const f of toImport){
      const isTerminado=terminados2024.find(x=>x.id===f.id)||terminados2025.find(x=>x.id===f.id)
      const payload={name:f.name,area:isTerminado?'Terminado':''}
      const {error}=await supabase.from('clients').insert(payload)
      if(!error){imported++;addLog(`✓ ${f.name}`)}
      else addLog(`✗ ${f.name}: ${error.message}`)
    }
    addLog(`─────────────────`)
    addLog(`${imported} clientes importados`)
    setStep('done')
    onImported()
    setSaving(false)
  }

  const allNew=[...newClients,...terminados2024,...terminados2025]
  const selectedCount=allNew.filter(f=>selected[f.id]).length

  return (
    <div>
      {step==='loading'&&<div style={{textAlign:'center',padding:20}}><Spin/><p style={{fontSize:13,color:C.muted,marginTop:12}}>Conectando con Drive...</p></div>}
      {step==='notoken'&&<div style={{textAlign:'center',padding:20}}><p style={{fontSize:13,marginBottom:16}}>Necesitas autorizar Drive.</p><button onClick={()=>getDriveToken().then(t=>{setToken(t);init()})} style={{padding:'10px 20px',borderRadius:8,border:'none',background:C.accent,color:'#fff',fontSize:13,fontWeight:600,cursor:'pointer'}}>Autorizar Drive</button></div>}
      {step==='error'&&<div style={{padding:20}}>{log.map((l,i)=><div key={i} style={{fontSize:12,color:C.overdue}}>{l}</div>)}</div>}
      {(step==='review'||step==='saving')&&(
        <div>
          {/* Clientes nuevos */}
          {newClients.length>0&&(
            <div style={{marginBottom:16}}>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:8}}>
                <div style={{fontSize:12,fontWeight:700,color:C.accent,textTransform:'uppercase',letterSpacing:.5}}>Clientes nuevos ({newClients.length})</div>
                <button onClick={()=>toggleAll(newClients)} style={{fontSize:11,color:C.accent,background:'none',border:'none',cursor:'pointer',fontWeight:600}}>{newClients.every(f=>selected[f.id])?'Deseleccionar todos':'Seleccionar todos'}</button>
              </div>
              {newClients.map(f=>(
                <div key={f.id} onClick={()=>toggle(f.id)} style={{display:'flex',alignItems:'center',gap:10,padding:'8px 10px',borderRadius:8,marginBottom:4,background:selected[f.id]?'#E6EEF1':'#F7F7F7',cursor:'pointer',border:`1px solid ${selected[f.id]?C.accent:C.border}`}}>
                  <div style={{width:16,height:16,borderRadius:4,border:`2px solid ${selected[f.id]?C.accent:C.border}`,background:selected[f.id]?C.accent:'transparent',display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}>
                    {selected[f.id]&&<span style={{color:'#fff',fontSize:10,fontWeight:700}}>✓</span>}
                  </div>
                  <span style={{fontSize:13,color:C.text}}>{f.name}</span>
                </div>
              ))}
            </div>
          )}
          {/* Terminados 2024 */}
          {terminados2024.length>0&&(
            <div style={{marginBottom:16}}>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:8}}>
                <div style={{fontSize:12,fontWeight:700,color:C.muted,textTransform:'uppercase',letterSpacing:.5}}>Terminados 2024 ({terminados2024.length})</div>
                <button onClick={()=>toggleAll(terminados2024)} style={{fontSize:11,color:C.muted,background:'none',border:'none',cursor:'pointer',fontWeight:600}}>{terminados2024.every(f=>selected[f.id])?'Deseleccionar todos':'Seleccionar todos'}</button>
              </div>
              {terminados2024.map(f=>(
                <div key={f.id} onClick={()=>toggle(f.id)} style={{display:'flex',alignItems:'center',gap:10,padding:'8px 10px',borderRadius:8,marginBottom:4,background:selected[f.id]?'#F7F2EC':'#F7F7F7',cursor:'pointer',border:`1px solid ${selected[f.id]?'#8B5C2A':C.border}`}}>
                  <div style={{width:16,height:16,borderRadius:4,border:`2px solid ${selected[f.id]?'#8B5C2A':C.border}`,background:selected[f.id]?'#8B5C2A':'transparent',display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}>
                    {selected[f.id]&&<span style={{color:'#fff',fontSize:10,fontWeight:700}}>✓</span>}
                  </div>
                  <span style={{fontSize:13,color:C.text}}>{f.name}</span>
                  <span style={{fontSize:10,color:'#8B5C2A',fontWeight:600,marginLeft:'auto'}}>2024</span>
                </div>
              ))}
            </div>
          )}
          {/* Terminados 2025 */}
          {terminados2025.length>0&&(
            <div style={{marginBottom:16}}>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:8}}>
                <div style={{fontSize:12,fontWeight:700,color:C.muted,textTransform:'uppercase',letterSpacing:.5}}>Terminados 2025 ({terminados2025.length})</div>
                <button onClick={()=>toggleAll(terminados2025)} style={{fontSize:11,color:C.muted,background:'none',border:'none',cursor:'pointer',fontWeight:600}}>{terminados2025.every(f=>selected[f.id])?'Deseleccionar todos':'Seleccionar todos'}</button>
              </div>
              {terminados2025.map(f=>(
                <div key={f.id} onClick={()=>toggle(f.id)} style={{display:'flex',alignItems:'center',gap:10,padding:'8px 10px',borderRadius:8,marginBottom:4,background:selected[f.id]?'#F7F2EC':'#F7F7F7',cursor:'pointer',border:`1px solid ${selected[f.id]?'#8B5C2A':C.border}`}}>
                  <div style={{width:16,height:16,borderRadius:4,border:`2px solid ${selected[f.id]?'#8B5C2A':C.border}`,background:selected[f.id]?'#8B5C2A':'transparent',display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}>
                    {selected[f.id]&&<span style={{color:'#fff',fontSize:10,fontWeight:700}}>✓</span>}
                  </div>
                  <span style={{fontSize:13,color:C.text}}>{f.name}</span>
                  <span style={{fontSize:10,color:'#8B5C2A',fontWeight:600,marginLeft:'auto'}}>2025</span>
                </div>
              ))}
            </div>
          )}
          {newClients.length===0&&terminados2024.length===0&&terminados2025.length===0&&(
            <div style={{textAlign:'center',padding:40,color:C.muted,fontSize:13}}>Todos los clientes de Drive ya están en la app ✓</div>
          )}
          <div style={{display:'flex',gap:8,marginTop:8,position:'sticky',bottom:0,background:C.bg,paddingBottom:8}}>
            <button onClick={onClose} style={{flex:1,padding:11,borderRadius:10,border:`1px solid ${C.border}`,background:'transparent',color:C.muted,fontSize:13,fontWeight:600,cursor:'pointer'}}>Cancelar</button>
            <button onClick={saveSelected} disabled={saving||selectedCount===0} style={{flex:2,padding:11,borderRadius:10,border:'none',background:C.accent,color:'#fff',fontSize:13,fontWeight:700,cursor:'pointer',opacity:selectedCount===0?.5:1}}>
              {saving?'Importando...':`Importar ${selectedCount} cliente${selectedCount!==1?'s':''}`}
            </button>
          </div>
        </div>
      )}
      {step==='done'&&(
        <div>
          <div style={{background:'#F7F7F7',borderRadius:8,padding:'10px 12px',maxHeight:200,overflowY:'auto',fontSize:12,fontFamily:'monospace',color:C.text,lineHeight:1.7,marginBottom:12}}>
            {log.map((l,i)=><div key={i}>{l}</div>)}
          </div>
          <button onClick={onClose} style={{width:'100%',padding:11,borderRadius:10,border:'none',background:C.accent,color:'#fff',fontSize:13,fontWeight:600,cursor:'pointer'}}>Cerrar</button>
        </div>
      )}
    </div>
  )
}

function DriveImporter({clients,billing,onImported,onClose,clientEntities}){
  const [step,setStep]=useState('init')
  const [token,setToken]=useState(null)
  const [years,setYears]=useState([])
  const [months,setMonths]=useState([])
  const [selYear,setSelYear]=useState(null)
  const [unmatched,setUnmatched]=useState([])
  const [assignments,setAssignments]=useState({})
  const [log,setLog]=useState([])
  const [progress,setProgress]=useState({done:0,total:0})
  const addLog=msg=>setLog(p=>[...p,msg])
  useEffect(()=>{init()},[])
  async function init(){
    setStep('loading')
    let t=localStorage.getItem('drive_token')
    if(!t){try{t=await getDriveToken()}catch(e){}}
    if(!t){setStep('notoken');return}
    setToken(t)
    try{
      const q0=encodeURIComponent(`'${FACTURACION_ROOT}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`)
      const res=await driveGet(t,`https://www.googleapis.com/drive/v3/files?q=${q0}&orderBy=name&fields=files(id,name)`)
      setYears(res.files||[]);setStep('selectMonth')
    }catch(e){setStep('error')}
  }
  async function loadMonths(yearId){
    setSelYear(yearId)
    const res=await driveGet(token,`https://www.googleapis.com/drive/v3/files?q='${yearId}'+in+parents+and+mimeType='application/vnd.google-apps.folder'+and+trashed=false&orderBy=name&fields=files(id,name)`)
    setMonths(res.files||[])
  }
  async function importMonth(monthId,monthName){
    setStep('importing');setLog([`Importando ${monthName}...`])
    const t=token
    const res=await driveGet(t,`https://www.googleapis.com/drive/v3/files?q='${monthId}'+in+parents+and+mimeType='application/pdf'+and+trashed=false&fields=files(id,name)`)
    const pdfs=res.files||[];setProgress({done:0,total:pdfs.length});addLog(`${pdfs.length} PDFs encontrados`)
    const results={imported:0,skipped:0,errors:0,rows:[]}
    for(let i=0;i<pdfs.length;i++){
      const pdf=pdfs[i]
      try{
        const binRes=await fetch(`https://www.googleapis.com/drive/v3/files/${pdf.id}?alt=media`,{headers:{Authorization:`Bearer ${t}`}})
        const arrayBuf=await binRes.arrayBuffer()
        let raw=''
        try{
          const pdfDoc=await pdfjsLib.getDocument({data:arrayBuf}).promise
          for(let p=1;p<=pdfDoc.numPages;p++){const page=await pdfDoc.getPage(p);const tc=await page.getTextContent();raw+=tc.items.map(i=>i.str).join(' ')+'\n'}
        }catch(e){raw=new TextDecoder('latin1').decode(arrayBuf)}
        const parsed=parseInvoice(raw)
        const exists=billing.some(b=>b.invoice_no===parsed.folio)
        if(exists){results.skipped++;addLog(`skip ${pdf.name}`);setProgress(p=>({...p,done:p.done+1}));continue}
        let mc=null
        // 1. Buscar en clientEntities por RUT (aprendizaje previo)
        if(parsed.rut){
          const ce=clientEntities.find(e=>normRut(e.rut)===normRut(parsed.rut))
          if(ce) mc=clients.find(c=>c.id===ce.client_id)
        }
        // 2. Buscar en clientEntities por nombre
        if(!mc&&parsed.cliente){
          const ce=clientEntities.find(e=>e.name?.toLowerCase()===parsed.cliente?.toLowerCase())
          if(ce) mc=clients.find(c=>c.id===ce.client_id)
        }
        // 3. Buscar en clients por rut directo
        if(!mc&&parsed.rut)mc=clients.find(c=>normRut(c.rut)===normRut(parsed.rut))
        // 4. Buscar en clients por nombre
        if(!mc&&parsed.cliente)mc=clients.find(c=>c.name?.toLowerCase()===parsed.cliente?.toLowerCase())
        if(parsed.folio&&parsed.total){
          if(!mc){
            // Sin cliente: guardar en Supabase sin client_id y agregar a review
            try{
              await upsertBilling({client_id:null,concept:parsed.concepto||'Sin descripción',receptor_name:parsed.cliente||null,receptor_rut:parsed.rut||null,amount:parsed.total,status:'Pendiente',invoice_no:parsed.folio,issued_at:parsed.issued_at,due:dueFromIssued(parsed.issued_at),notes:null})
            }catch(e){
              if(!e.message?.includes('duplicate')) addLog(`error guardando ${pdf.name}: ${e.message}`)
            }
            results.unmatched = results.unmatched||[]
            results.unmatched.push({id:parsed.folio,folio:parsed.folio,rut:parsed.rut,cliente:parsed.cliente,amount:parsed.total,issued_at:parsed.issued_at,concepto:parsed.concepto})
            addLog(`⚠ ${pdf.name} — sin cliente (${parsed.cliente||'?'})`)
          } else {
            // Con cliente: guardar con client_id y aprendizaje
            try{
              await upsertBilling({client_id:mc.id,concept:parsed.concepto||'Sin descripción',receptor_name:parsed.cliente||null,receptor_rut:parsed.rut||null,amount:parsed.total,status:'Pendiente',invoice_no:parsed.folio,issued_at:parsed.issued_at,due:dueFromIssued(parsed.issued_at),notes:null})
              if(parsed.rut){
                await supabase.from('client_entities').upsert({client_id:mc.id,rut:parsed.rut,name:parsed.cliente||null},{onConflict:'rut'})
              }
            }catch(e){
              if(!e.message?.includes('duplicate')) addLog(`error guardando ${pdf.name}: ${e.message}`)
            }
            results.rows.push({...parsed,clientMatch:mc,fileName:pdf.name});results.imported++
            addLog(`ok ${pdf.name} — ${parsed.cliente||'?'} · $${parsed.total?.toLocaleString('es-CL')||'?'}`)
          }
        }
      }catch(e){results.errors++;addLog(`error ${pdf.name}: ${e.message}`)}
      setProgress(p=>({...p,done:p.done+1}))
    }
    addLog('—————————————————————————')
    addLog(`${results.imported} procesadas · ${results.skipped} ya existian · ${results.errors} errores${results.unmatched?.length?` · ${results.unmatched.length} sin cliente`:''}`)
    if(results.unmatched?.length>0){
      setUnmatched(results.unmatched)
      setStep('review')
    } else {
      setStep('done');onImported(results.rows)
    }
  }
  const saveAssignmentsDrive = async() => {
    for(const inv of unmatched){
      const clientId = assignments[inv.id]
      if(!clientId) continue
      await supabase.from('billing').update({client_id:clientId}).eq('invoice_no',inv.folio)
      if(inv.rut){
        await supabase.from('client_entities').upsert({client_id:clientId,rut:inv.rut,name:inv.cliente||null},{onConflict:'rut'})
      } else if(inv.cliente){
        await supabase.from('client_entities').upsert({client_id:clientId,rut:null,name:inv.cliente},{onConflict:'rut'})
      }
    }
    setStep('done');onImported([])
  }

  return (
    <div>
      {step==='loading'&&<div style={{textAlign:'center',padding:20}}><Spin/><p style={{fontSize:13,color:C.muted,marginTop:12}}>Conectando...</p></div>}
      {step==='notoken'&&<div style={{textAlign:'center',padding:20}}><p style={{fontSize:13,marginBottom:16}}>Necesitas autorizar Drive.</p><button onClick={connectDrive} style={{padding:'10px 20px',borderRadius:8,border:'none',background:C.accent,color:'#fff',fontSize:13,fontWeight:600,cursor:'pointer'}}>Autorizar Drive</button></div>}
      {step==='selectMonth'&&(
        <div>
          <p style={{fontSize:13,color:C.muted,marginBottom:12}}>Selecciona año y mes:</p>
          <div style={{display:'flex',gap:8,flexWrap:'wrap',marginBottom:16}}>
            {years.map(y=><button key={y.id} onClick={()=>loadMonths(y.id)} style={{padding:'6px 14px',borderRadius:8,border:`1px solid ${selYear===y.id?C.accent:C.border}`,background:selYear===y.id?'#E6EEF1':'#fff',color:selYear===y.id?C.accent:C.text,fontSize:13,fontWeight:600,cursor:'pointer'}}>{y.name}</button>)}
          </div>
          {months.length>0&&<div style={{display:'flex',gap:6,flexWrap:'wrap'}}>{months.map(m=><button key={m.id} onClick={()=>importMonth(m.id,m.name)} style={{padding:'6px 14px',borderRadius:8,border:`1px solid ${C.border}`,background:'#fff',color:C.text,fontSize:13,cursor:'pointer'}}>{m.name}</button>)}</div>}
        </div>
      )}
      {step==='review'&&(
        <div>
          <div style={{background:'#F7F7F7',borderRadius:8,padding:'10px 12px',maxHeight:120,overflowY:'auto',fontSize:12,fontFamily:'monospace',color:C.text,lineHeight:1.7,marginBottom:14}}>
            {log.map((l,i)=><div key={i}>{l}</div>)}
          </div>
          <div style={{fontSize:13,fontWeight:600,color:C.text,marginBottom:4}}>Asignar clientes</div>
          <div style={{fontSize:11,color:C.muted,marginBottom:12}}>Estas facturas no se pudieron asociar automáticamente. Asígnalas una vez y el RUT quedará guardado para siempre.</div>
          {unmatched.map(inv=>(
            <InvoiceClientPicker key={inv.id} inv={inv} clients={clients} assigned={clients.find(c=>c.id===assignments[inv.id])} onAssign={clientId=>setAssignments(p=>({...p,[inv.id]:clientId}))}/>
          ))}
          <div style={{display:'flex',gap:8,marginTop:4}}>
            <button onClick={()=>{setStep('done');onImported([])}} style={{flex:1,padding:11,borderRadius:10,border:`1px solid ${C.border}`,background:'transparent',color:C.muted,fontSize:13,fontWeight:600,cursor:'pointer'}}>Omitir</button>
            <button onClick={saveAssignmentsDrive} style={{flex:2,padding:11,borderRadius:10,border:'none',background:C.accent,color:'#fff',fontSize:13,fontWeight:700,cursor:'pointer'}}>Guardar asignaciones</button>
          </div>
        </div>
      )}
      {(step==='importing'||step==='done')&&(
        <div>
          {step==='importing'&&<div style={{display:'flex',alignItems:'center',gap:8,marginBottom:12}}><Spin/><span style={{fontSize:13,color:C.muted}}>{progress.done}/{progress.total}</span></div>}
          <div style={{background:'#F7F7F7',borderRadius:8,padding:'10px 12px',maxHeight:260,overflowY:'auto',fontSize:12,fontFamily:'monospace',color:C.text,lineHeight:1.6}}>
            {log.map((l,i)=><div key={i}>{l}</div>)}
          </div>
          {step==='done'&&<button onClick={onClose} style={{marginTop:14,width:'100%',padding:11,borderRadius:10,border:'none',background:C.accent,color:'#fff',fontSize:13,fontWeight:600,cursor:'pointer'}}>Cerrar</button>}
        </div>
      )}
      {step==='error'&&<div style={{color:C.overdue,fontSize:13,textAlign:'center',padding:20}}>Error al conectar con Drive.</div>}
    </div>
  )
}

// ─── PDF UPLOADER ─────────────────────────────────────────────────────────────
function InvoiceClientPicker({inv,clients,assigned,onAssign}) {
  const [q,setQ] = useState('')
  const matches = useMemo(()=>{
    if(!q.trim()) return []
    return clients.filter(c=>c.name.toLowerCase().includes(q.toLowerCase())).sort((a,b)=>a.name.localeCompare(b.name,'es')).slice(0,6)
  },[q,clients])
  return (
    <div style={{background:C.card,borderRadius:10,padding:'12px 14px',marginBottom:8,border:`1px solid ${assigned?C.accent:C.border}`}}>
      <div style={{display:'flex',justifyContent:'space-between',marginBottom:8}}>
        <div>
          <div style={{fontSize:13,fontWeight:600,color:C.text}}>Factura N° {inv.folio}</div>
          <div style={{fontSize:11,color:C.muted}}>{inv.cliente||inv.fileName}{inv.rut?` · RUT: ${inv.rut}`:''}</div>
          {inv.concepto&&<div style={{fontSize:11,color:C.muted,fontStyle:'italic'}}>{inv.concepto}</div>}
        </div>
        <div style={{fontSize:13,fontWeight:700,color:C.text,flexShrink:0,marginLeft:8}}>{fmt(inv.amount)}</div>
      </div>
      {assigned?(
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'8px 12px',borderRadius:8,background:'#E6EEF1',border:`1px solid ${C.accent}`}}>
          <span style={{fontSize:13,fontWeight:600,color:C.accent}}>{assigned.name}</span>
          <button onClick={()=>{onAssign('');setQ('')}} style={{background:'none',border:'none',color:C.muted,fontSize:12,cursor:'pointer'}}>Cambiar</button>
        </div>
      ):(
        <div style={{position:'relative'}}>
          <input value={q} onChange={e=>setQ(e.target.value)} placeholder='Escribe para buscar cliente...'
            style={{width:'100%',padding:'8px 12px',borderRadius:8,border:`1px solid ${C.border}`,background:'#F7F7F7',color:C.text,fontSize:13,boxSizing:'border-box',outline:'none'}}/>
          {matches.length>0&&(
            <div style={{position:'absolute',top:'100%',left:0,right:0,background:'#fff',border:`1px solid ${C.border}`,borderRadius:8,boxShadow:'0 4px 16px rgba(0,0,0,.12)',zIndex:100,marginTop:4,maxHeight:200,overflowY:'auto'}}>
              {matches.map(c=>(
                <div key={c.id} onMouseDown={()=>{onAssign(c.id);setQ('')}}
                  style={{padding:'9px 14px',cursor:'pointer',borderBottom:`1px solid ${C.border}`,fontSize:13}}
                  onMouseEnter={e=>e.currentTarget.style.background='#F0F4F6'}
                  onMouseLeave={e=>e.currentTarget.style.background='#fff'}>
                  <div style={{fontWeight:500}}>{c.name}</div>
                  {c.rut&&<div style={{fontSize:11,color:C.muted}}>{c.rut}</div>}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function PDFUploader({clients,billing,onImported,onClose,onClientsUpdate,clientEntities}) {
  const [step,setStep] = useState('select') // select | processing | review | done
  const [log,setLog] = useState([])
  const [progress,setProgress] = useState({done:0,total:0})
  const [unmatched,setUnmatched] = useState([]) // [{invoiceId, folio, rut, cliente, amount, issued_at, concepto}]
  const [assignments,setAssignments] = useState({}) // {invoiceId: clientId}
  const fileRef = useRef(null)
  const addLog = msg => setLog(p=>[...p,msg])

  const readPdfText = (file) => new Promise((resolve)=>{
    const reader = new FileReader()
    reader.onload = async(e)=>{
      try {
        const typedArr = new Uint8Array(e.target.result)
        const pdfDoc = await pdfjsLib.getDocument({data:typedArr}).promise
        let text = ''
        for(let p=1;p<=pdfDoc.numPages;p++){
          const page = await pdfDoc.getPage(p)
          const tc = await page.getTextContent()
          text += tc.items.map(i=>i.str).join(' ') + '\n'
        }
        resolve(text)
      } catch(err) {
        const r2 = new FileReader()
        r2.onload = e2 => resolve(e2.target.result)
        r2.readAsText(file, 'latin1')
      }
    }
    reader.readAsArrayBuffer(file)
  })

  const processFiles = async(files) => {
    if(!files.length) return
    setStep('processing')
    setLog([`${files.length} archivo${files.length!==1?'s':''} seleccionado${files.length!==1?'s':''}`])
    setProgress({done:0,total:files.length})
    const results = {imported:0,skipped:0,errors:0}
    const pendingReview = []

    for(let i=0;i<files.length;i++){
      const file = files[i]
      try {
        const raw = await readPdfText(file)
        const parsed = parseInvoice(raw)
        // Verificar duplicado en DB directamente (más confiable que el estado en memoria)
        const {data:existing} = await supabase.from('billing').select('id').eq('invoice_no',parsed.folio).maybeSingle()
        if(existing){ results.skipped++; addLog(`⏭ ${file.name} — ya existe (N° ${parsed.folio})`); setProgress(p=>({...p,done:p.done+1})); continue }

        // Match por RUT: primero en client_entities (aprendizaje previo), luego en clients.rut, luego por nombre
        let matchedClient = null
        if(parsed.rut) {
          const rutClean = parsed.rut.replace(/[.\-\s]/g,'')
          const entity = (clientEntities||[]).find(e=>e.rut.replace(/[.\-\s]/g,'')===rutClean)
          if(entity) matchedClient = clients.find(c=>c.id===entity.client_id)
          if(!matchedClient) matchedClient = clients.find(c=>c.rut&&c.rut.replace(/[.\-\s]/g,'')===rutClean)
        }
        if(!matchedClient&&parsed.cliente) matchedClient = clients.find(c=>c.name?.toLowerCase()===parsed.cliente?.toLowerCase())

        if(parsed.folio&&parsed.total){
          try {
            await upsertBilling({
              client_id: matchedClient?.id||null,
              concept: parsed.concepto||'Sin descripción',
              receptor_name: parsed.cliente||null,
              receptor_rut: parsed.rut||null,
              amount: parsed.total,
              status: 'Pendiente',
              invoice_no: parsed.folio,
              issued_at: parsed.issued_at,
              due: dueFromIssued(parsed.issued_at),
              notes: null,
            })
            results.imported++
            if(matchedClient){
              addLog(`✓ ${file.name} — ${matchedClient.name}${parsed.concepto?' · '+parsed.concepto:''} · ${fmt(parsed.total)}`)
            } else {
              addLog(`⚠ ${file.name} — ${parsed.cliente||'sin cliente'} · ${fmt(parsed.total)}`)
              if(parsed.folio) pendingReview.push({
                id: parsed.folio,
                folio: parsed.folio,
                rut: parsed.rut,
                cliente: parsed.cliente,
                amount: parsed.total,
                issued_at: parsed.issued_at,
                concepto: parsed.concepto,
                fileName: file.name
              })
            }
          } catch(e){ addLog(`✗ ${file.name} — ${e.message}`) }
        } else {
          addLog(`⚠ ${file.name} — no se pudo leer (folio: ${parsed.folio||'?'}, monto: ${parsed.total||'?'})`)
        }
      } catch(e){
        results.errors++
        addLog(`✗ ${file.name} — ${e.message}`)
      }
      setProgress(p=>({...p,done:p.done+1}))
    }

    addLog('─────────────────────────')
    addLog(`✅ ${results.imported} importadas · ⏭ ${results.skipped} ya existían · ❌ ${results.errors} errores`)

    if(pendingReview.length>0){
      setUnmatched(pendingReview)
      setStep('review')
    } else {
      setStep('done')
      onImported([])
    }
  }

  const saveAssignments = async() => {
    for(const inv of unmatched){
      const clientId = assignments[inv.id]
      if(!clientId) continue
      // Actualizar el cobro con el cliente
      await supabase.from('billing').update({client_id:clientId}).eq('invoice_no',inv.folio)
      // Guardar en client_entities para match automático futuro
      if(inv.rut){
        await supabase.from('client_entities').upsert({client_id:clientId, rut:inv.rut, name:inv.cliente||null},{onConflict:'rut'})
        if(onClientsUpdate) onClientsUpdate()
      }
    }
    setStep('done')
    onImported([])
  }

  return (
    <div>
      {step==='select'&&(
        <div>
          <p style={{fontSize:13,color:C.muted,marginBottom:16,lineHeight:1.5}}>
            Selecciona uno o varios PDFs de facturas. Se importarán automáticamente y se asociarán al cliente por RUT.
          </p>
          <input ref={fileRef} type='file' accept='.pdf,application/pdf' multiple style={{display:'none'}} onChange={e=>processFiles(Array.from(e.target.files))}/>
          <button onClick={()=>fileRef.current?.click()} style={{width:'100%',padding:'14px',borderRadius:10,border:`2px dashed ${C.accent}`,background:'#F0F5F7',color:C.accent,fontSize:14,fontWeight:600,cursor:'pointer',marginBottom:8}}>
            ↑ Seleccionar PDFs
          </button>
          <p style={{fontSize:11,color:C.muted,textAlign:'center'}}>Puedes seleccionar múltiples archivos a la vez</p>
        </div>
      )}

      {(step==='processing')&&(
        <div>
          <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:12}}>
            <Spin/>
            <span style={{fontSize:13,color:C.muted}}>{progress.done}/{progress.total} archivos procesados…</span>
          </div>
          <div style={{background:'#F7F7F7',borderRadius:8,padding:'10px 12px',maxHeight:200,overflowY:'auto',fontSize:12,fontFamily:'monospace',color:C.text,lineHeight:1.7}}>
            {log.map((l,i)=><div key={i}>{l}</div>)}
          </div>
        </div>
      )}

      {step==='review'&&(
        <div>
          <div style={{background:'#F7F7F7',borderRadius:8,padding:'10px 12px',maxHeight:160,overflowY:'auto',fontSize:12,fontFamily:'monospace',color:C.text,lineHeight:1.7,marginBottom:14}}>
            {log.map((l,i)=><div key={i}>{l}</div>)}
          </div>
          <div style={{fontSize:13,fontWeight:600,color:C.text,marginBottom:4}}>Asignar clientes</div>
          <div style={{fontSize:11,color:C.muted,marginBottom:12}}>Estas facturas no se pudieron asociar automáticamente. Asígnalas una vez y el RUT quedará guardado para siempre.</div>
          {unmatched.map(inv=>(
            <InvoiceClientPicker key={inv.id} inv={inv} clients={clients} assigned={clients.find(c=>c.id===assignments[inv.id])} onAssign={clientId=>setAssignments(p=>({...p,[inv.id]:clientId}))}/>
          ))}
          <div style={{display:'flex',gap:8,marginTop:4}}>
            <button onClick={()=>{setStep('done');onImported([])}} style={{flex:1,padding:11,borderRadius:10,border:`1px solid ${C.border}`,background:'transparent',color:C.muted,fontSize:13,fontWeight:600,cursor:'pointer'}}>Omitir</button>
            <button onClick={saveAssignments} style={{flex:2,padding:11,borderRadius:10,border:'none',background:C.accent,color:'#fff',fontSize:13,fontWeight:700,cursor:'pointer'}}>Guardar asignaciones</button>
          </div>
        </div>
      )}

      {step==='done'&&(
        <div>
          <div style={{background:'#F7F7F7',borderRadius:8,padding:'10px 12px',maxHeight:200,overflowY:'auto',fontSize:12,fontFamily:'monospace',color:C.text,lineHeight:1.7,marginBottom:12}}>
            {log.map((l,i)=><div key={i}>{l}</div>)}
          </div>
          <div style={{display:'flex',gap:8}}>
            <button onClick={()=>{setStep('select');setLog([]);setProgress({done:0,total:0});setUnmatched([]);setAssignments({})}} style={{flex:1,padding:11,borderRadius:10,border:`1px solid ${C.border}`,background:'transparent',color:C.muted,fontSize:13,fontWeight:600,cursor:'pointer'}}>Subir más</button>
            <button onClick={onClose} style={{flex:2,padding:11,borderRadius:10,border:'none',background:C.accent,color:'#fff',fontSize:13,fontWeight:600,cursor:'pointer'}}>Cerrar</button>
          </div>
        </div>
      )}
    </div>
  )
}


// ─── REPORT BUILDER ──────────────────────────────────────────────────────────
function ReportBuilder({sales,billing,clients,expenses,tasks,onClose}) {
  const [sections,setSections] = useState({ventas:true,cobranza:true,gastos:true,tareas:false})
  const [period,setPeriod] = useState('month')
  const [selYear,setSelYear] = useState(String(currentYear))
  const [selMonth,setSelMonth] = useState(String(currentMonth))
  const MONTHS=['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre']
  const years=[...new Set([...sales.map(s=>s.year),...billing.map(b=>b.issued_at?.slice(0,4)).filter(Boolean)].filter(Boolean))].sort((a,b)=>b-a)
  if(!years.includes(currentYear)) years.unshift(currentYear)
  const toggle=k=>setSections(p=>({...p,[k]:!p[k]}))
  const getPeriodLabel=()=>period==='year'?`Año ${selYear}`:`${MONTHS[parseInt(selMonth)-1]} ${selYear}`

  const filterByPeriod=(items,dateField)=>items.filter(item=>{
    const d=item[dateField]; if(!d) return false
    if(period==='year') return d.startsWith(selYear)
    return d.startsWith(`${selYear}-${String(selMonth).padStart(2,'0')}`)
  })

  const generatePDF=()=>{
    const label=getPeriodLabel()
    const now=new Date().toLocaleDateString('es-CL',{day:'2-digit',month:'long',year:'numeric'})
    const A='#003C50', A2='#537281', A3='#99ABB4', A4='#E4E8EB', G='#3D3D3D'
    const fmtN=n=>new Intl.NumberFormat('es-CL',{style:'currency',currency:'CLP',maximumFractionDigits:0}).format(n||0)
    const fmtUFN=n=>n?`UF ${Number(n).toLocaleString('es-CL',{minimumFractionDigits:2,maximumFractionDigits:2})}`:'—'

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
  .report-title{text-align:right}
  .report-title h1{font-size:16px;font-weight:600;margin-bottom:4px}
  .report-title p{font-size:10px;opacity:.8}
  .section{margin-bottom:28px}
  .section-title{font-size:13px;font-weight:700;color:${A};text-transform:uppercase;letter-spacing:.8px;border-bottom:2px solid ${A};padding-bottom:6px;margin-bottom:14px}
  .kpi-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:16px}
  .kpi{background:${A4};border-radius:6px;padding:12px 14px}
  .kpi-label{font-size:9px;color:${A2};text-transform:uppercase;letter-spacing:.6px;margin-bottom:4px;font-weight:600}
  .kpi-value{font-size:16px;font-weight:700;color:${A}}
  .kpi-sub{font-size:9px;color:${A2};margin-top:2px}
  .progress-bar{height:8px;background:#E8EEF0;border-radius:4px;overflow:hidden;margin:6px 0 2px}
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
  .badge-pending{background:#E3EEF3;color:${A}}
  .badge-overdue{background:#FBE9E7;color:#C2382B}
  .badge-paid{background:#E4F1EA;color:#2E7D55}
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
          <div class="firma-name">Liberona Escala Abogados</div>
          <div class="firma-sub">leabogados.cl</div>
        </div>
        <div class="report-title">
          <h1>Reporte de Gestión</h1>
          <p>${label} · Generado ${now}</p>
        </div>
      </div>
    </div>`

    // ── VENTAS
    if(sections.ventas){
      const ss=filterByPeriod(sales.map(s=>({...s,date:`${s.year}-${String(s.month||1).padStart(2,'0')}-01`})),'date')
      const brutoUF=ss.reduce((a,s)=>a+(parseFloat(s.amount_uf)||0),0)
      const costoUF=ss.reduce((a,s)=>a+(parseFloat(s.cost_uf)||0),0)
      const netoUF=brutoUF-costoUF
      const pct=Math.min(100,Math.round((netoUF/9800)*100))
      html+=`<div class="section">
        <div class="section-title">Ventas</div>
        <div class="kpi-grid">
          <div class="kpi"><div class="kpi-label">Bruto</div><div class="kpi-value">${fmtUFN(brutoUF)}</div></div>
          <div class="kpi"><div class="kpi-label">Costo terceros</div><div class="kpi-value" style="color:#C2382B">${costoUF>0?fmtUFN(costoUF):'—'}</div></div>
          <div class="kpi"><div class="kpi-label">Neto</div><div class="kpi-value" style="color:#2E7D55">${fmtUFN(netoUF)}</div></div>
        </div>
        <div style="margin-bottom:16px;padding:10px 14px;background:${A4};border-radius:6px">
          <div style="display:flex;justify-content:space-between;margin-bottom:4px">
            <span style="font-size:10px;font-weight:600;color:${A}">Avance meta anual UF 9.800</span>
            <span style="font-size:13px;font-weight:700;color:${A}">${pct}%</span>
          </div>
          <div class="progress-bar"><div class="progress-fill" style="width:${pct}%"></div></div>
        </div>`
      if(ss.length>0){
        html+=`<table><thead><tr><th>Cliente</th><th>Proyecto</th><th>Área</th><th>Estado</th><th style="text-align:right">UF Bruto</th><th style="text-align:right">UF Costo</th><th style="text-align:right">UF Neto</th></tr></thead><tbody>`
        ss.forEach(s=>{
          const c=clients.find(x=>x.id===s.client_id)
          const neto=(parseFloat(s.amount_uf)||0)-(parseFloat(s.cost_uf)||0)
          html+=`<tr><td>${c?.name||'—'}</td><td>${s.title||'—'}</td><td><span class="badge badge-area">${s.area||'—'}</span></td><td>${s.status||'—'}</td><td style="text-align:right">${fmtUFN(s.amount_uf)}</td><td style="text-align:right;color:#C2382B">${s.cost_uf>0?fmtUFN(s.cost_uf):'—'}</td><td style="text-align:right;color:#2E7D55;font-weight:600">${fmtUFN(neto)}</td></tr>`
        })
        html+=`</tbody><tfoot><tr><td colspan="4">TOTAL</td><td style="text-align:right">${fmtUFN(brutoUF)}</td><td style="text-align:right;color:#C2382B">${fmtUFN(costoUF)}</td><td style="text-align:right;color:#2E7D55">${fmtUFN(netoUF)}</td></tr></tfoot></table>`
      } else {
        html+=`<p style="color:${A3};font-style:italic;text-align:center;padding:16px">Sin ventas en este período</p>`
      }
      html+=`</div>`
    }

    // ── COBRANZA
    if(sections.cobranza){
      const bb=filterByPeriod(billing,'issued_at')
      const pending=bb.filter(b=>b.status==='Pendiente').reduce((a,b)=>a+(b.amount||0),0)
      const overdue=bb.filter(b=>b.status==='Vencido').reduce((a,b)=>a+(b.amount||0),0)
      const paid=bb.filter(b=>b.status==='Pagado').reduce((a,b)=>a+(b.amount||0),0)
      html+=`<div class="section${sections.ventas?' page-break':''}">
        <div class="section-title">Cobranza</div>
        <div class="kpi-grid">
          <div class="kpi"><div class="kpi-label">Por cobrar</div><div class="kpi-value">${fmtN(pending)}</div></div>
          <div class="kpi"><div class="kpi-label">Vencido</div><div class="kpi-value" style="color:#C2382B">${fmtN(overdue)}</div></div>
          <div class="kpi"><div class="kpi-label">Cobrado</div><div class="kpi-value" style="color:#2E7D55">${fmtN(paid)}</div></div>
        </div>`
      if(bb.length>0){
        html+=`<table><thead><tr><th>Cliente</th><th>Concepto</th><th>N° Factura</th><th>Emisión</th><th>Estado</th><th style="text-align:right">Monto</th><th>Antigüedad</th></tr></thead><tbody>`
        bb.sort((a,b)=>(a.status==='Vencido'?0:1)-(b.status==='Vencido'?0:1)).forEach(b=>{
          const c=clients.find(x=>x.id===b.client_id)
          const dias=b.due?Math.round((new Date()-new Date(b.due+'T12:00'))/86400000):null
          const badgeClass=b.status==='Pagado'?'badge-paid':b.status==='Vencido'?'badge-overdue':'badge-pending'
          const diasStr=dias!==null&&dias>0?`${dias}d vencido`:dias!==null&&dias<0?`${Math.abs(dias)}d restantes`:'—'
          html+=`<tr><td>${c?.name||'—'}</td><td style="max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${b.concept||'—'}</td><td style="font-family:monospace">${b.invoice_no||'—'}</td><td>${b.issued_at||'—'}</td><td><span class="badge ${badgeClass}">${b.status}</span></td><td style="text-align:right;font-weight:600">${fmtN(b.amount)}</td><td style="color:${dias>0?'#C2382B':A2}">${diasStr}</td></tr>`
        })
        html+=`</tbody><tfoot><tr><td colspan="5">TOTAL</td><td style="text-align:right">${fmtN(pending+overdue+paid)}</td><td></td></tr></tfoot></table>`
      } else {
        html+=`<p style="color:${A3};font-style:italic;text-align:center;padding:16px">Sin cobros en este período</p>`
      }
      html+=`</div>`
    }

    // ── GASTOS
    if(sections.gastos){
      const balances={}
      expenses.forEach(e=>{ if(!balances[e.client_id])balances[e.client_id]={fondos:0,gastos:0}; e.type==='fondo'?balances[e.client_id].fondos+=e.amount:balances[e.client_id].gastos+=e.amount })
      const clientsWithMovs=clients.filter(c=>balances[c.id])
      html+=`<div class="section page-break">
        <div class="section-title">Gastos y Fondos</div>
        <table style="margin-bottom:16px"><thead><tr><th>Cliente</th><th style="text-align:right">Fondos recibidos</th><th style="text-align:right">Gastos realizados</th><th style="text-align:right">Saldo</th></tr></thead><tbody>`
      clientsWithMovs.forEach(c=>{
        const b=balances[c.id]
        const sal=b.fondos-b.gastos
        html+=`<tr><td>${c.name}</td><td style="text-align:right;color:#2E7D55">${fmtN(b.fondos)}</td><td style="text-align:right;color:#C2382B">${fmtN(b.gastos)}</td><td style="text-align:right;font-weight:700;color:${sal<0?'#C2382B':'#2E7D55'}">${fmtN(sal)}</td></tr>`
      })
      html+=`</tbody></table></div>`
    }

    // ── TAREAS
    if(sections.tareas){
      const activeTasks=tasks.filter(t=>t.status==='Activo')
      const WHO=['Cristóbal','Martín','Martina','Erasmo','Rodrigo']
      html+=`<div class="section page-break"><div class="section-title">Tareas Activas</div>`
      WHO.forEach(who=>{
        const mine=activeTasks.filter(t=>t.who===who).sort((a,b)=>(daysLeft(a.due)||999)-(daysLeft(b.due)||999))
        if(!mine.length) return
        html+=`<div class="who-section"><div class="who-title">${who} · ${mine.length} tarea${mine.length!==1?'s':''}</div>
        <table><thead><tr><th>Cliente</th><th>Proyecto</th><th>Tarea</th><th>Plazo</th><th>Estado</th></tr></thead><tbody>`
        mine.forEach(t=>{
          const c=clients.find(x=>x.id===t.client_id)
          const u=urgency(t.due,t.status)
          const color=u==='overdue'?'#C2382B':u==='urgent'?'#C77F18':u==='soon'?'#C77F18':'#2E7D55'
          const dias=t.due?daysLeft(t.due):null
          const diasStr=dias!==null?(dias<0?`${Math.abs(dias)}d vencido`:dias===0?'hoy':`${dias}d`):''
          html+=`<tr><td>${c?.name||'—'}</td><td>${t.project||'—'}</td><td>${t.title}</td><td>${t.due||'—'}</td><td style="color:${color};font-weight:600">${diasStr}</td></tr>`
        })
        html+=`</tbody></table></div>`
      })
      html+=`</div>`
    }

    // Footer
    html+=`<div class="footer"><span>Liberona Escala Abogados · leabogados.cl</span><span>Reporte ${label} · ${now}</span><span>CONFIDENCIAL</span></div>`
    html+=`<button class="print-btn no-print" onclick="window.print()">Imprimir / Guardar PDF</button>`
    html+=`</body></html>`

    const win=window.open('','_blank')
    win.document.write(html)
    win.document.close()
    setTimeout(()=>win.focus(),300)
  }

  const anySelected=Object.values(sections).some(Boolean)

  return (
    <div>
      <div style={{marginBottom:16}}>
        <Lbl>Período</Lbl>
        <div style={{display:'flex',gap:6,marginBottom:10}}>
          {[['month','Por mes'],['year','Por año']].map(([v,l])=>(
            <button key={v} onClick={()=>setPeriod(v)} style={{flex:1,padding:'8px',borderRadius:8,border:`1px solid ${period===v?C.accent:C.border}`,background:period===v?'#E6EEF1':'transparent',color:period===v?C.accent:C.muted,fontSize:12,fontWeight:600,cursor:'pointer'}}>{l}</button>
          ))}
        </div>
        <div style={{display:'grid',gridTemplateColumns:period==='month'?'1fr 1fr':'1fr',gap:8}}>
          <select value={selYear} onChange={e=>setSelYear(e.target.value)} style={{padding:'9px 12px',borderRadius:8,border:`1px solid ${C.border}`,background:'#F7F7F7',color:C.text,fontSize:13}}>
            {years.map(y=><option key={y} value={y}>{y}</option>)}
          </select>
          {period==='month'&&(
            <select value={selMonth} onChange={e=>setSelMonth(e.target.value)} style={{padding:'9px 12px',borderRadius:8,border:`1px solid ${C.border}`,background:'#F7F7F7',color:C.text,fontSize:13}}>
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
          <div key={k} onClick={()=>toggle(k)} style={{display:'flex',gap:12,alignItems:'flex-start',padding:'10px 14px',borderRadius:10,border:`1px solid ${sections[k]?C.accent:C.border}`,background:sections[k]?'#E6EEF1':'#fff',marginBottom:8,cursor:'pointer'}}>
            <div style={{width:20,height:20,borderRadius:5,border:`2px solid ${sections[k]?C.accent:C.border}`,background:sections[k]?C.accent:'transparent',display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0,marginTop:1}}>
              {sections[k]&&<span style={{color:'#fff',fontSize:11,fontWeight:700}}>✓</span>}
            </div>
            <div>
              <div style={{fontSize:13,fontWeight:600,color:sections[k]?C.accent:C.text}}>{label}</div>
              <div style={{fontSize:11,color:C.muted,marginTop:2}}>{desc}</div>
            </div>
          </div>
        ))}
      </div>

      {anySelected&&(
        <div style={{background:'#F7F7F7',borderRadius:8,padding:'10px 14px',marginBottom:16,fontSize:12,color:C.muted}}>
          {Object.entries(sections).filter(([,v])=>v).length} sección{Object.entries(sections).filter(([,v])=>v).length!==1?'es':''} · {getPeriodLabel()} · Tamaño carta vertical
        </div>
      )}

      <div style={{display:'flex',gap:8}}>
        <button onClick={onClose} style={{flex:1,padding:11,borderRadius:10,border:`1px solid ${C.border}`,background:'transparent',color:C.muted,fontSize:13,fontWeight:600,cursor:'pointer'}}>Cancelar</button>
        <button disabled={!anySelected} onClick={generatePDF} style={{flex:2,padding:11,borderRadius:10,border:'none',background:C.accent,color:'#fff',fontSize:13,fontWeight:700,cursor:'pointer',opacity:!anySelected?.6:1}}>
          Ver reporte
        </button>
      </div>
    </div>
  )
}


// ─── TASKS ONLY VIEW (para usuarios limited) ──────────────────────────────────
function printTasks(tasks, clients, filterLabel) {
  const today = new Date().toLocaleDateString('es-CL',{weekday:'long',day:'numeric',month:'long',year:'numeric'})
  const rows = tasks.map(t=>{
    const client = clients.find(c=>c.id===t.client_id)
    const due = t.due ? new Date(t.due+'T00:00:00').toLocaleDateString('es-CL',{day:'numeric',month:'short'}) : '—'
    const urgent = t.due && daysLeft(t.due)<0 ? 'color:#C2382B;font-weight:600' : ''
    return `<tr>
      <td style="padding:8px 10px;border-bottom:1px solid #eee;font-size:12px">${t.title}</td>
      <td style="padding:8px 10px;border-bottom:1px solid #eee;font-size:11px;color:#666">${client?.name||'—'}</td>
      <td style="padding:8px 10px;border-bottom:1px solid #eee;font-size:11px;color:#666">${t.project||'—'}</td>
      <td style="padding:8px 10px;border-bottom:1px solid #eee;font-size:11px;${urgent}">${due}</td>
      <td style="padding:8px 10px;border-bottom:1px solid #eee;font-size:11px;color:#666">${t.who||'—'}</td>
    </tr>`
  }).join('')
  const html = `<!DOCTYPE html><html><head><meta charset="UTF-8">
  <title>Tareas pendientes</title>
  <style>
    body{font-family:'Helvetica Neue',Arial,sans-serif;margin:0;padding:24px;color:#1a1a1a}
    h1{font-size:18px;font-weight:700;color:#003C50;margin:0 0 4px}
    .sub{font-size:11px;color:#999;margin-bottom:20px}
    table{width:100%;border-collapse:collapse}
    thead tr{background:#003C50;color:#fff}
    th{padding:8px 10px;text-align:left;font-size:11px;font-weight:600;letter-spacing:.5px;text-transform:uppercase}
    @media print{body{padding:0}}
  </style></head><body>
  <h1>Tareas pendientes${filterLabel?' — '+filterLabel:''}</h1>
  <div class="sub">Liberona Escala Abogados · ${today} · ${tasks.length} tarea${tasks.length!==1?'s':''}</div>
  <table><thead><tr><th>Tarea</th><th>Cliente</th><th>Proyecto</th><th>Vence</th><th>Responsable</th></tr></thead>
  <tbody>${rows}</tbody></table>
  <script>window.onload=()=>{window.print()}<\/script>
  </body></html>`
  const w = window.open('','_blank')
  w.document.write(html)
  w.document.close()
}

function TasksOnlyView({tasks,clients,sales,onAddTask,currentUserName}) {
  const [filterWho,setFilterWho] = useState(currentUserName||'todos')
  const [filterClient,setFilterClient] = useState('')
  const [filterProject,setFilterProject] = useState('')
  const [filterDay,setFilterDay] = useState('')

  const today = new Date().toISOString().slice(0,10)
  const tomorrow = new Date(Date.now()+86400000).toISOString().slice(0,10)
  const weekEnd = new Date(Date.now()+7*86400000).toISOString().slice(0,10)
  const WHO_LIST = ['Cristóbal','Erasmo','Martín','Martina','Rodrigo']
  const allProjects = [...new Set(tasks.filter(t=>t.project).map(t=>t.project))].sort()

  const filtered = tasks.filter(t=>{
    if(t.status!=='Activo') return false
    if(filterWho!=='todos' && t.who!==filterWho) return false
    if(filterClient && !clients.find(c=>c.id===t.client_id)?.name?.toLowerCase().includes(filterClient.toLowerCase())) return false
    if(filterProject && t.project!==filterProject) return false
    if(filterDay==='hoy' && t.due!==today) return false
    if(filterDay==='mañana' && t.due!==tomorrow) return false
    if(filterDay==='semana' && (t.due<today||t.due>weekEnd)) return false
    if(filterDay==='sinFecha' && t.due) return false
    return true
  }).sort((a,b)=>(daysLeft(a.due)||999)-(daysLeft(b.due)||999))

  return (
    <div>
      <div style={{padding:'20px 20px 10px',position:'sticky',top:0,background:C.bg,zIndex:10}}>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:10}}>
          <div style={{fontSize:20,fontWeight:600,color:C.text,fontFamily:"'DM Sans',sans-serif",letterSpacing:-.4}}>Mis Tareas</div>
          <div style={{display:'flex',gap:6}}>
            <button onClick={()=>printTasks(filtered,clients,filterWho!=='todos'?filterWho:'')} style={{padding:'6px 12px',borderRadius:8,border:`1px solid ${C.border}`,background:'#fff',color:C.muted,fontSize:12,fontWeight:600,cursor:'pointer'}}>↓ Imprimir</button>
            <button onClick={onAddTask} style={{padding:'6px 14px',borderRadius:8,border:'none',background:C.accent,color:'#fff',fontSize:12,fontWeight:600,cursor:'pointer'}}>+ Tarea</button>
          </div>
        </div>
        <div style={{display:'flex',gap:6,flexWrap:'wrap',marginBottom:8}}>
          <select value={filterWho} onChange={e=>setFilterWho(e.target.value)} style={{padding:'5px 8px',borderRadius:7,border:`1px solid ${C.border}`,fontSize:11,background:'#F7F7F7',color:C.text}}>
            <option value='todos'>Todos</option>
            {WHO_LIST.map(w=><option key={w} value={w}>{w}</option>)}
          </select>
          <select value={filterDay} onChange={e=>setFilterDay(e.target.value)} style={{padding:'5px 8px',borderRadius:7,border:`1px solid ${filterDay?C.accent:C.border}`,fontSize:11,background:filterDay?'#E6EEF1':'#F7F7F7',color:filterDay?C.accent:C.text}}>
            <option value=''>Cualquier fecha</option>
            <option value='hoy'>Hoy</option>
            <option value='mañana'>Mañana</option>
            <option value='semana'>Esta semana</option>
            <option value='sinFecha'>Sin fecha</option>
          </select>
          <select value={filterProject} onChange={e=>setFilterProject(e.target.value)} style={{padding:'5px 8px',borderRadius:7,border:`1px solid ${filterProject?C.accent:C.border}`,fontSize:11,background:filterProject?'#E6EEF1':'#F7F7F7',color:filterProject?C.accent:C.text}}>
            <option value=''>Todos los proyectos</option>
            {allProjects.map(p=><option key={p} value={p}>{p}</option>)}
          </select>
          <input value={filterClient} onChange={e=>setFilterClient(e.target.value)} placeholder='Buscar cliente...' style={{padding:'5px 8px',borderRadius:7,border:`1px solid ${filterClient?C.accent:C.border}`,fontSize:11,background:filterClient?'#E6EEF1':'#F7F7F7',color:C.text,width:110}}/>
          {(filterWho!=='todos'||filterDay||filterProject||filterClient)&&
            <button onClick={()=>{setFilterWho(currentUserName||'todos');setFilterDay('');setFilterProject('');setFilterClient('')}} style={{padding:'5px 8px',borderRadius:7,border:`1px solid ${C.border}`,fontSize:11,background:'transparent',color:C.muted,cursor:'pointer'}}>✕ Limpiar</button>
          }
        </div>
        <div style={{fontSize:11,color:C.muted}}>{filtered.length} tarea{filtered.length!==1?'s':''}</div>
      </div>
      <div style={{padding:'4px 20px 100px'}}>
        {filtered.map(t=>{
          const client=clients.find(c=>c.id===t.client_id)
          return (
            <div key={t.id} style={{background:C.card,borderRadius:10,padding:'11px 14px',marginBottom:7,border:`1px solid ${C.border}`,borderLeft:`3px solid ${urgencyColor(t.due,t.status)}`}}>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start'}}>
                <div style={{fontSize:13,fontWeight:600,color:C.text,marginBottom:2,flex:1}}>{t.title}</div>
                {t.who&&<span style={{fontSize:10,padding:'2px 7px',borderRadius:10,background:'#E6EEF1',color:C.accent,fontWeight:600,flexShrink:0,marginLeft:8}}>{t.who}</span>}
              </div>
              <div style={{fontSize:11,color:C.muted,display:'flex',gap:8,flexWrap:'wrap',marginTop:2}}>
                {client&&<span>{client.name}</span>}
                {t.project&&<span>· {t.project}</span>}
                {t.due&&<><span>·</span><DaysBadge due={t.due} status={t.status}/></>}
              </div>
              {t.note&&<div style={{fontSize:11,color:C.muted,fontStyle:'italic',marginTop:4}}>{t.note}</div>}
            </div>
          )
        })}
        {filtered.length===0&&<div style={{color:C.muted,textAlign:'center',padding:40}}>Sin tareas{filterDay||filterProject||filterClient?' con estos filtros':' activas'}</div>}
        {activeTasks.length===0&&<div style={{color:C.muted,textAlign:'center',padding:40}}>Sin tareas activas</div>}
      </div>
    </div>
  )
}

// ─── USERS VIEW (gestión de usuarios para admin) ───────────────────────────────
function UsersView({onClose}) {
  const [users,setUsers] = useState([])
  const [loading,setLoading] = useState(true)
  const [saving,setSaving] = useState(false)
  const [newEmail,setNewEmail] = useState('')
  const [newName,setNewName] = useState('')
  const [newRole,setNewRole] = useState('limited')

  useEffect(()=>{
    supabase.from('user_roles').select('*').order('name').then(({data})=>{ setUsers(data||[]); setLoading(false) })
  },[])

  const saveRole = async(id,role) => {
    await supabase.from('user_roles').update({role}).eq('id',id)
    setUsers(p=>p.map(u=>u.id===id?{...u,role}:u))
  }

  const addUser = async() => {
    if(!newEmail.trim()) return
    setSaving(true)
    const {data,error} = await supabase.from('user_roles').insert({email:newEmail.trim().toLowerCase(),name:newName.trim()||newEmail.split('@')[0],role:newRole}).select().single()
    if(!error) { setUsers(p=>[...p,data]); setNewEmail(''); setNewName('') }
    else alert('Error: '+error.message)
    setSaving(false)
  }

  const removeUser = async(id) => {
    if(!confirm('¿Eliminar este usuario?')) return
    await supabase.from('user_roles').delete().eq('id',id)
    setUsers(p=>p.filter(u=>u.id!==id))
  }

  return (
    <div>
      {loading?<div style={{textAlign:'center',padding:30}}><Spin/></div>:(
        <>
          <div style={{marginBottom:16}}>
            {users.map(u=>(
              <div key={u.id} style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'10px 0',borderBottom:`1px solid ${C.border}`}}>
                <div>
                  <div style={{fontSize:13,fontWeight:600,color:C.text}}>{u.name}</div>
                  <div style={{fontSize:11,color:C.muted}}>{u.email}</div>
                </div>
                <div style={{display:'flex',gap:8,alignItems:'center'}}>
                  <select value={u.role} onChange={e=>saveRole(u.id,e.target.value)} style={{padding:'5px 8px',borderRadius:6,border:`1px solid ${C.border}`,background:'#F7F7F7',color:C.text,fontSize:12}}>
                    <option value='admin'>Admin</option>
                    <option value='limited'>Limitado</option>
                  </select>
                  <button onClick={()=>removeUser(u.id)} style={{background:'none',border:'none',color:C.muted,cursor:'pointer',fontSize:16}}>×</button>
                </div>
              </div>
            ))}
          </div>
          <div style={{background:'#F7F7F7',borderRadius:10,padding:'12px 14px'}}>
            <div style={{fontSize:12,fontWeight:600,color:C.text,marginBottom:10}}>Agregar usuario</div>
            <Fld label='Email (@leabogados.cl)'><Inp value={newEmail} onChange={e=>setNewEmail(e.target.value)} placeholder='nombre@leabogados.cl'/></Fld>
            <Fld label='Nombre'><Inp value={newName} onChange={e=>setNewName(e.target.value)} placeholder='Nombre completo'/></Fld>
            <Fld label='Rol'>
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8}}>
                {[['admin','Admin (acceso completo)'],['limited','Limitado (solo tareas y gastos)']].map(([v,l])=>(
                  <button key={v} onClick={()=>setNewRole(v)} style={{padding:'8px',borderRadius:8,border:`2px solid ${newRole===v?C.accent:C.border}`,background:newRole===v?'#E6EEF1':'transparent',color:newRole===v?C.accent:C.muted,fontSize:11,fontWeight:600,cursor:'pointer'}}>{l}</button>
                ))}
              </div>
            </Fld>
            <button disabled={saving||!newEmail.trim()} onClick={addUser} style={{width:'100%',padding:11,borderRadius:10,border:'none',background:C.accent,color:'#fff',fontSize:13,fontWeight:700,cursor:'pointer',marginTop:8,opacity:!newEmail.trim()?.6:1}}>
              {saving?'Guardando...':'Agregar usuario'}
            </button>
          </div>
        </>
      )}
    </div>
  )
}

// ─── APP ROOT ─────────────────────────────────────────────────────────────────
export default function App() {
  const [session,setSession]=useState(null)
  const [loadingAuth,setLoadingAuth]=useState(true)
  const [user,setUser]=useState(null)
  const [userRole,setUserRole]=useState(null) // 'admin' | 'limited' | null
  const [clients,setClients]=useState([])
  const [sales,setSales]=useState([])
  const [billing,setBilling]=useState([])
  const [expenses,setExpenses]=useState([])
  const [tasks,setTasks]=useState([])
  const [loading,setLoading]=useState(false)
  const [saving,setSaving]=useState(false)
  const [tab,setTab]=useState('dashboard')
  const [hideErasmo,setHideErasmo]=useState(true)
  const [modal,setModal]=useState(null)

  const loadUserRole = async(email) => {
    const {data} = await supabase.from('user_roles').select('*').eq('email',email).maybeSingle()
    if(data) {
      setUserRole(data.role)
      if(data.role==='limited') setTab('tasks')
      return data
    }
    await supabase.from('user_roles').insert({email,role:'limited',name:email.split('@')[0]})
    setUserRole('limited')
    setTab('tasks')
    return {role:'limited',name:email.split('@')[0]}
  }

  useEffect(()=>{
    getSession().then(({data:{session}})=>{
      setSession(session)
      if(session){ loadUserRole(session.user.email).then(u=>setUser({email:session.user.email,name:u?.name||session.user.email.split('@')[0]})) }
      setLoadingAuth(false)
    })
    const {data:{subscription}}=onAuthChange(async(_,session)=>{
      setSession(session)
      if(session){
        const u = await loadUserRole(session.user.email)
        setUser({email:session.user.email,name:u?.name||session.user.email.split('@')[0]})
        if(session.provider_token)saveDriveToken(session.provider_token)
      } else { setUser(null); setUserRole(null) }
    })
    return ()=>subscription.unsubscribe()
  },[])

  const [clientEntities,setClientEntities] = useState([])

  useEffect(()=>{
    if(!session) return
    setLoading(true)
    Promise.all([
      getClients(),
      supabase.from('sales').select('*').order('created_at',{ascending:false}).then(({data})=>data||[]),
      getBilling(),
      supabase.from('expenses').select('*').order('date',{ascending:false}).then(({data})=>data||[]),
      supabase.from('tasks').select('*').order('due',{ascending:true,nullsFirst:false}).then(({data})=>data||[]),
      supabase.from('client_entities').select('*').then(({data})=>data||[]),
    ]).then(([c,s,b,e,t,ce])=>{setClients(c);setSales(s);setBilling(b);setExpenses(e);setTasks(t);setClientEntities(ce)})
      .catch(console.error).finally(()=>setLoading(false))
  },[session])

  const handleSaveSale=useCallback(async(f)=>{
    setSaving(true)
    try{
      const {cobros, cobroType, ...saleData} = f
      const entIdRaw = saleData.entity_id || null
      const esCLP = (f.moneda||'UF')==='CLP'
      const p={...saleData,entity_id:entIdRaw,moneda:f.moneda||'UF',amount_uf:esCLP?null:(parseFloat(f.amount_uf)||null),cost_uf:esCLP?null:(parseFloat(f.cost_uf)||null),uf_value:esCLP?null:(parseFloat(f.uf_value)||null),amount_clp:esCLP?(parseFloat(f.amount_clp)||null):(saleData.amount_clp||null),updated_at:new Date().toISOString()}
      const{data,error}=await supabase.from('sales').upsert(p).select().single()
      if(error)throw error
      setSales(p=>f.id?p.map(x=>x.id===data.id?data:x):[data,...p])
      // Crear cobros sólo al crear la venta (programadas = sin folio)
      if(cobros&&cobros.length>0&&!f.id){
        for(const c of cobros){
          await supabase.from('billing').insert({
            client_id:data.client_id,
            sale_id:data.id,
            entity_id:entIdRaw,
            concept:`${data.title} — ${c.label}`,
            amount:c.monto,
            status:'Programada',
            due:c.fecha,
            billing_type:'honorarios',
          })
        }
      }
      // Propagar razón social a las cuotas Programadas de esta venta (crea o edita)
      if(entIdRaw){
        const ent = (clientEntities||[]).find(e=>e.id===entIdRaw)
        await supabase.from('billing').update({
          entity_id:entIdRaw,
          receptor_name:ent?.name||null,
          receptor_rut:ent?.rut||null,
        }).eq('sale_id',data.id).eq('status','Programada')
      }
      const {data:newBilling} = await getBilling()
      if(newBilling) setBilling(newBilling)
      setModal(null)
    }catch(e){alert('Error: '+e.message)}
    setSaving(false)
  },[clients,clientEntities])

  const handleDeleteSale=useCallback(async(id)=>{
    if(!confirm('Eliminar esta venta?')) return
    await supabase.from('sales').delete().eq('id',id)
    setSales(p=>p.filter(x=>x.id!==id));setModal(null)
  },[])

  const handleSaveExpense=useCallback(async(f)=>{
    setSaving(true)
    try{
      const p={...f,amount:parseInt(f.amount)||0,sale_id:f.sale_id||null}
      const{data,error}=await supabase.from('expenses').upsert(p).select().single()
      if(error)throw error
      setExpenses(p=>f.id?p.map(x=>x.id===data.id?data:x):[data,...p])
      setModal(null)
    }catch(e){alert('Error: '+e.message)}
    setSaving(false)
  },[])

  const handleDeleteExpense=useCallback(async(id)=>{
    if(!confirm('Eliminar este registro?')) return
    await supabase.from('expenses').delete().eq('id',id)
    setExpenses(p=>p.filter(x=>x.id!==id));setModal(null)
  },[])

  const handleSaveTask=useCallback(async(f)=>{
    setSaving(true)
    try{
      const{data,error}=await supabase.from('tasks').upsert({...f,sale_id:f.sale_id||null,client_id:f.client_id||null}).select().single()
      if(error)throw error
      setTasks(p=>f.id?p.map(x=>x.id===data.id?data:x):[data,...p])
      // Alerta email solo en tarea NUEVA con quien asignado
      if(!f.id && data.who){
        const client=clients.find(c=>c.id===data.client_id)
        fetch('https://kibuwhtpoxrnfowfdolu.supabase.co/functions/v1/notify-task',{
          method:'POST',
          headers:{'Content-Type':'application/json','Authorization':'Bearer '+supabase.supabaseKey},
          body:JSON.stringify({task:{...data,client_name:client?.name||''},assignedBy:user?.user_metadata?.name||'el estudio'})
        }).catch(()=>{})
      }
      setModal(null)
    }catch(e){alert('Error: '+e.message)}
    setSaving(false)
  },[])

  const handleSaveClient=useCallback(async(f)=>{
    setSaving(true)
    try{
      const payload={...f,name:f.name.trim(),updated_at:new Date().toISOString()}
      if(payload.status!=='Terminado')payload.ended_at=null
      else if(!payload.ended_at)payload.ended_at=new Date().toISOString().slice(0,10)
      const saved=await upsertClient(payload)
      setClients(p=>{const next=f.id?p.map(x=>x.id===saved.id?saved:x):[...p,saved];return next.sort((a,b)=>(a.name||'').localeCompare(b.name||'','es'))})
      setModal(null)
    }catch(e){alert('Error: '+e.message)}
    setSaving(false)
  },[])

  const handleDeleteClient=useCallback(async(id)=>{
    if(!confirm('Eliminar este cliente y todos sus datos?')) return
    try{
      await dbDeleteClient(id)
      setClients(p=>p.filter(x=>x.id!==id));setSales(p=>p.filter(s=>s.client_id!==id))
      setBilling(p=>p.filter(b=>b.client_id!==id));setExpenses(p=>p.filter(e=>e.client_id!==id))
      setModal(null)
    }catch(e){alert('Error: '+e.message)}
  },[])

  const handleSaveBilling=useCallback(async(f)=>{
    setSaving(true)
    try{
      // Limpiar campos virtuales que no van a la DB
      const {clients:_c, erasmo:_e, ...rest} = f
      const payload={...rest,amount:parseInt(f.amount)||0,updated_at:new Date().toISOString()}
      const saved=await upsertBilling(payload)
      setBilling(p=>{
        const wc={...saved,clients:clients.find(c=>c.id===saved.client_id)}
        return f.id?p.map(x=>x.id===saved.id?wc:x):[wc,...p]
      })
      // Aprendizaje universal: si la factura trae razón social, la guarda en el catálogo
      if(saved.client_id && (saved.receptor_name||saved.receptor_rut)){
        const yaExiste=(clientEntities||[]).some(e=>e.client_id===saved.client_id&&((e.rut&&e.rut===saved.receptor_rut)||(e.name?.toLowerCase()===saved.receptor_name?.toLowerCase())))
        if(!yaExiste){
          await supabase.from('client_entities').insert({client_id:saved.client_id,name:saved.receptor_name||null,rut:saved.receptor_rut||null})
          const ce=await supabase.from('client_entities').select('*').then(({data})=>data||[])
          setClientEntities(ce)
        }
      }
      setModal(null)
    }catch(e){alert('Error: '+e.message)}
    setSaving(false)
  },[clients,clientEntities])

  const handleDeleteBilling=useCallback(async(id)=>{
    if(!confirm('¿Eliminar este cobro?')) return
    try{
      await supabase.from('billing').delete().eq('id',id)
      setBilling(p=>p.filter(x=>x.id!==id))
      setModal(null)
    }catch(e){alert('Error: '+e.message)}
  },[])

  const handleToggleClientStatus=useCallback(async(client)=>{
    const nuevo = client.status==='Terminado' ? 'Activo' : 'Terminado'
    try{
      const {data,error} = await supabase.from('clients').update({status:nuevo,updated_at:new Date().toISOString()}).eq('id',client.id).select().single()
      if(error) throw error
      setClients(p=>p.map(x=>x.id===client.id?{...x,status:nuevo}:x))
    }catch(e){alert('Error: '+e.message)}
  },[])

  const handleAssignClient=useCallback(async(bill,clientId)=>{
    if(!clientId) return
    try{
      // 1. Asignar el cliente a la factura
      await supabase.from('billing').update({client_id:clientId,updated_at:new Date().toISOString()}).eq('id',bill.id)
      setBilling(p=>p.map(x=>x.id===bill.id?{...x,client_id:clientId}:x))
      // 2. Aprender el RUT/razón social ↔ cliente (para que próximas facturas se asocien solas)
      if(bill.receptor_rut||bill.receptor_name){
        const yaExiste=(clientEntities||[]).some(e=>e.client_id===clientId&&((e.rut&&e.rut===bill.receptor_rut)||(e.name?.toLowerCase()===bill.receptor_name?.toLowerCase())))
        if(!yaExiste){
          await supabase.from('client_entities').insert({client_id:clientId,name:bill.receptor_name||null,rut:bill.receptor_rut||null})
          const ce=await supabase.from('client_entities').select('*').then(({data})=>data||[])
          setClientEntities(ce)
        }
      }
    }catch(e){alert('Error: '+e.message)}
  },[clientEntities])

  // Eliminar una o varias cuotas (usado por "Ya emitida"); el confirm lo hace el componente
  const handleDeleteBillingBulk=useCallback(async(ids)=>{
    const arr=Array.isArray(ids)?ids:[ids]
    if(arr.length===0) return
    try{
      await supabase.from('billing').delete().in('id',arr)
      setBilling(p=>p.filter(x=>!arr.includes(x.id)))
    }catch(e){alert('Error: '+e.message)}
  },[])

  const handleStatusChange=useCallback(async(id,status,paid_at)=>{
    const updates={status}
    if(paid_at!==undefined) updates.paid_at=paid_at
    await supabase.from('billing').update(updates).eq('id',id)
    setBilling(p=>p.map(x=>x.id===id?{...x,status,...(paid_at!==undefined?{paid_at}:{})}:x))
  },[])

  const overdueN=useMemo(()=>{
    const bb=hideErasmo?billing.filter(b=>!b.erasmo):billing
    return bb.filter(b=>b.status==='Vencido').length
  },[billing,hideErasmo])

  if(loadingAuth) return <div style={{minHeight:'100vh',background:C.bg,display:'flex',alignItems:'center',justifyContent:'center'}}><Spin/></div>
  if(!session) return <LoginScreen loading={loadingAuth}/>

  return (
    <>
      <link href={FONT} rel='stylesheet'/>
      <style>{`
        *{box-sizing:border-box;margin:0;padding:0;-webkit-tap-highlight-color:transparent}
        body{background:${C.bg};color:${C.text};font-family:'DM Sans',sans-serif;-webkit-font-smoothing:antialiased}
        input,select,textarea{font-family:'DM Sans',sans-serif}
        input:focus,select:focus,textarea:focus{border-color:${C.accent}!important;box-shadow:0 0 0 3px rgba(0,60,80,.10)}
        ::-webkit-scrollbar{width:0;height:0}
        @keyframes spin{to{transform:rotate(360deg)}}
        @media(min-width:680px){
          .shell{max-width:600px;margin:0 auto;box-shadow:0 0 0 1px ${C.border},0 12px 50px rgba(0,0,0,.08);min-height:100vh}
          .fab{right:auto!important;left:50%!important;margin-left:228px}
        }
      `}</style>
      <div className='shell' style={{background:C.bg,minHeight:'100vh',position:'relative'}}>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'52px 20px 4px',position:'sticky',top:0,background:C.bg,zIndex:20}}>
          <button onClick={signOut} style={{background:'none',border:'none',color:C.muted,fontSize:11,cursor:'pointer',fontWeight:500}}>{user?.name} · Salir</button>
          <div style={{display:'flex',gap:6}}>
            {userRole==='admin'&&<button onClick={()=>setModal({type:'users'})} style={{padding:'5px 10px',borderRadius:8,border:`1px solid ${C.border}`,background:'#fff',color:C.muted,fontSize:11,fontWeight:600,cursor:'pointer'}}>👥</button>}
            {userRole==='admin'&&<button onClick={()=>setModal({type:'report'})} style={{padding:'5px 10px',borderRadius:8,border:`1px solid ${C.border}`,background:'#fff',color:C.accent,fontSize:11,fontWeight:600,cursor:'pointer'}}>↓ Reporte</button>}
            {userRole==='admin'&&<button onClick={()=>setHideErasmo(h=>!h)} style={{padding:'5px 12px',borderRadius:20,border:`1px solid ${hideErasmo?C.accent:C.border}`,background:hideErasmo?'#E6EEF1':'transparent',color:hideErasmo?C.accent:C.muted,fontSize:11,fontWeight:600,cursor:'pointer'}}>
              {hideErasmo?'Vista personal':'Todo el estudio'}
            </button>}
          </div>
        </div>
        {loading?(
          <div style={{display:'flex',alignItems:'center',justifyContent:'center',height:'60vh'}}><Spin/></div>
        ):(
          <div style={{paddingBottom:80,overflowY:'auto'}}>
            {tab==='dashboard'&&userRole==='admin'&&<Dashboard sales={sales} billing={billing} clients={clients} expenses={expenses} tasks={tasks} hideErasmo={hideErasmo} setTab={setTab} user={user}/>}
            {tab==='sales'&&userRole==='admin'&&<SalesView sales={sales} clients={clients} hideErasmo={hideErasmo} onEdit={s=>setModal({type:'sale',data:s})} onAdd={()=>setModal({type:'sale',data:null})}/>}
            {tab==='billing'&&userRole==='admin'&&<BillingView billing={billing} clients={clients} sales={sales} hideErasmo={hideErasmo} onAssignClient={handleAssignClient} onStatusChange={handleStatusChange} onDelete={handleDeleteBillingBulk} onAdd={()=>setModal({type:'billing',data:null})} onEdit={b=>setModal({type:'billing',data:b})} onImport={()=>setModal({type:'drive',data:null})} onUpload={()=>setModal({type:'pdfupload',data:null})}/>}
            {tab==='expenses'&&<ExpensesView expenses={expenses} clients={clients} onAdd={()=>setModal({type:'gastos',data:null})} onEdit={e=>setModal({type:'expenseEdit',data:e})} onAddFondo={()=>setModal({type:'fondo',data:null})}/>}
            {tab==='clients'&&userRole==='admin'&&<ClientsView clients={clients} sales={sales} billing={billing} expenses={expenses} tasks={tasks} clientEntities={clientEntities} onToggleStatus={handleToggleClientStatus} onEdit={c=>setModal({type:'client',data:c})} onAdd={()=>setModal({type:'client',data:null})} onAddTask={(c)=>setModal({type:'task',data:c?{preClient:c}:null})} onAddGasto={(c)=>setModal({type:'gastos',data:c})} onAddFondo={(c)=>setModal({type:'fondo',data:c})} onAddSale={(c)=>setModal({type:'sale',data:{client_id:c.id}})} onAddBilling={(c)=>setModal({type:'billing',data:{client_id:c.id}})} onImportDrive={()=>setModal({type:'clienteDrive'})}/>}
          </div>
        )}
        <BottomNav tab={tab} setTab={setTab} overdueN={overdueN} userRole={userRole}/>
        <button className='fab' onClick={()=>{
          const map={sales:'sale',billing:'billing',expenses:'gastos',clients:'task'}
          setModal({type:map[tab]||'sale',data:null})
        }} style={{position:'fixed',bottom:80,right:20,width:48,height:48,borderRadius:'50%',background:C.accent,border:'none',cursor:'pointer',fontSize:22,color:'#fff',display:'flex',alignItems:'center',justifyContent:'center',boxShadow:'0 6px 20px rgba(0,60,80,.32)',zIndex:100}}>+</button>

        {modal?.type==='sale'&&<Modal title={modal.data?.id?'Editar venta':'Nueva venta'} onClose={()=>setModal(null)}><SaleForm sale={modal.data?.id?modal.data:{...modal.data}} clients={clients} clientEntities={clientEntities} onSave={handleSaveSale} onClose={()=>setModal(null)} onDelete={handleDeleteSale} saving={saving}/></Modal>}
        {modal?.type==='billing'&&<Modal title={modal.data?.id?'Editar cobro':'Nuevo cobro'} onClose={()=>setModal(null)}><BillingForm bill={modal.data} clients={clients} clientEntities={clientEntities} onSave={handleSaveBilling} onClose={()=>setModal(null)} onDelete={handleDeleteBilling} saving={saving}/></Modal>}
        {modal?.type==='gastos'&&<Modal title='Registrar gastos' onClose={()=>setModal(null)}><GastosForm clients={clients} expenses={expenses} onSave={handleSaveExpense} onClose={()=>setModal(null)} preClient={modal.data||null}/></Modal>}
        {modal?.type==='fondo'&&<Modal title='Registrar fondo recibido' onClose={()=>setModal(null)}><FondoForm clients={clients} expenses={expenses} onSave={async(f)=>{await handleSaveExpense(f);setModal(null)}} onClose={()=>setModal(null)} saving={saving} preClient={modal.data||null}/></Modal>}
        {modal?.type==='expenseEdit'&&<Modal title='Editar registro' onClose={()=>setModal(null)}><ExpenseEditForm expense={modal.data} clients={clients} onSave={handleSaveExpense} onClose={()=>setModal(null)} onDelete={handleDeleteExpense} saving={saving}/></Modal>}
        {modal?.type==='clienteDrive'&&<Modal title='Importar clientes desde Drive' onClose={()=>setModal(null)}><ClienteDriveImporter clients={clients} onImported={async()=>{const c=await getClients();setClients(c);setModal(null)}} onClose={()=>setModal(null)}/></Modal>}
        {modal?.type==='pdfupload'&&<Modal title='Subir facturas PDF' onClose={()=>setModal(null)}><PDFUploader clients={clients} billing={billing} clientEntities={clientEntities} onImported={()=>{}} onClose={()=>setModal(null)} onClientsUpdate={async()=>{const c=await getClients();setClients(c);const ce=await supabase.from('client_entities').select('*').then(({data})=>data||[]);setClientEntities(ce)}}/></Modal>}
        {modal?.type==='drive'&&<Modal title='Importar facturas desde Drive' onClose={()=>setModal(null)}><DriveImporter clients={clients} billing={billing} clientEntities={clientEntities} onImported={()=>{}} onClose={()=>setModal(null)}/></Modal>}
        {modal?.type==='users'&&<Modal title='Gestión de usuarios' onClose={()=>setModal(null)}><UsersView onClose={()=>setModal(null)}/></Modal>}
        {modal?.type==='report'&&<Modal title='Generar reporte' onClose={()=>setModal(null)}><ReportBuilder sales={sales} billing={billing} clients={clients} expenses={expenses} tasks={tasks} onClose={()=>setModal(null)}/></Modal>}
        {modal?.type==='task'&&<Modal title='Nueva tarea' onClose={()=>setModal(null)}><QuickTaskForm clients={clients} sales={sales} tasks={tasks} onSave={handleSaveTask} onClose={()=>setModal(null)} saving={saving} preClient={modal.data?.preClient||null}/></Modal>}
        {modal?.type==='client'&&<Modal title={modal.data?.id?'Editar cliente':'Nuevo cliente'} onClose={()=>setModal(null)}><ClientForm client={modal.data} onSave={handleSaveClient} onClose={()=>setModal(null)} onDelete={handleDeleteClient} saving={saving} sales={sales}/></Modal>}
      </div>
    </>
  )
}
