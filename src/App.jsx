import { useState, useEffect, useCallback, useMemo } from 'react'
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

const TABS = [
  {id:'dashboard',icon:'house',label:'Inicio'},
  {id:'sales',icon:'tag',label:'Ventas'},
  {id:'billing',icon:'dollar',label:'Cobros'},
  {id:'expenses',icon:'minus',label:'Gastos'},
  {id:'clients',icon:'person',label:'Clientes'},
]

function BottomNav({tab,setTab,overdueN}) {
  const icons = {house:'⌂',tag:'◈',dollar:'$',minus:'⊖',person:'⊙'}
  return (
    <div className='bottomnav' style={{position:'fixed',bottom:0,left:0,right:0,background:C.surface,borderTop:`1px solid ${C.border}`,display:'flex',zIndex:50,paddingBottom:'env(safe-area-inset-bottom,0)'}}>
      {TABS.map(t=>(
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
                        <div style={{fontSize:13,fontWeight:500,color:C.text,marginBottom:2}}>{t.title}</div>
                        <div style={{fontSize:11,color:C.muted,display:'flex',gap:6,alignItems:'center',flexWrap:'wrap'}}>
                          <span style={{overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{client?.name?.split('/')[0].trim()||'—'}</span>
                          {t.due&&<><span>·</span><DaysBadge due={t.due} status={t.status}/></>}
                          {t.note&&<><span>·</span><span style={{overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',fontStyle:'italic'}}>{t.note}</span></>}
                        </div>
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
function Dashboard({sales,billing,clients,expenses,tasks,hideErasmo,setTab,user}) {
  const yr = currentYear
  const bb = hideErasmo ? billing.filter(b=>!b.erasmo) : billing
  const ss = hideErasmo ? sales : sales

  const vendido = ss.filter(s=>s.year===yr).reduce((a,s)=>{
    const clp = s.amount_clp || (s.amount_uf&&s.uf_value ? Math.round(s.amount_uf*s.uf_value) : 0)
    return a+clp
  },0)
  const vendidoUF = ss.filter(s=>s.year===yr).reduce((a,s)=>a+(parseFloat(s.amount_uf)||0),0)
  const facturado = bb.filter(b=>b.issued_at?.startsWith(String(yr))).reduce((a,b)=>a+(b.amount||0),0)
  const cobrado = bb.filter(b=>b.status==='Pagado'&&(b.paid_at?.startsWith(String(yr))||b.issued_at?.startsWith(String(yr)))).reduce((a,b)=>a+(b.amount||0),0)

  const porCobrar = bb.filter(b=>['Pendiente','Vencido'].includes(b.status))
  const totalPorCobrar = porCobrar.reduce((a,b)=>a+(b.amount||0),0)
  const age0_30  = porCobrar.filter(b=>{ const d=daysLeft(b.due); return d!==null&&d>=-30 }).reduce((a,b)=>a+(b.amount||0),0)
  const age31_60 = porCobrar.filter(b=>{ const d=daysLeft(b.due); return d!==null&&d<-30&&d>=-60 }).reduce((a,b)=>a+(b.amount||0),0)
  const age60p   = porCobrar.filter(b=>{ const d=daysLeft(b.due); return d!==null&&d<-60 }).reduce((a,b)=>a+(b.amount||0),0)
  const top5 = [...porCobrar].sort((a,b)=>(daysLeft(a.due)||0)-(daysLeft(b.due)||0)).slice(0,5)

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

      <div style={{padding:'0 20px'}}>
        <div style={{fontSize:11,fontWeight:600,color:C.muted,textTransform:'uppercase',letterSpacing:.5,marginBottom:8}}>Pipeline {yr}</div>
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:8,marginBottom:16}}>
          {[
            ['Vendido',fmt(vendido),vendidoUF>0?fmtUF(vendidoUF):null,'#E3EEF3',C.accent],
            ['Facturado',fmt(facturado),null,'#EEF3E3',C.normal],
            ['Cobrado',fmt(cobrado),null,'#E4F1EA',C.normal],
          ].map(([l,v,sub,bg,col])=>(
            <div key={l} style={{background:bg,borderRadius:10,padding:'10px 12px',border:`1px solid ${C.border}`}}>
              <div style={{fontSize:10,color:C.muted,marginBottom:4,textTransform:'uppercase',letterSpacing:.4,fontWeight:600}}>{l}</div>
              <div style={{fontSize:12,fontWeight:700,color:col,lineHeight:1.2}}>{v}</div>
              {sub&&<div style={{fontSize:10,color:C.muted,marginTop:2}}>{sub}</div>}
            </div>
          ))}
        </div>
      </div>

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
            {[['0-30d',fmt(age0_30),C.soon],['31-60d',fmt(age31_60),C.overdue],['+60d',fmt(age60p),C.overdue]].map(([l,v,col])=>(
              <div key={l} style={{textAlign:'center',padding:'6px 0',borderRadius:7,background:'#F7F7F7'}}>
                <div style={{fontSize:10,color:C.muted,marginBottom:2}}>{l}</div>
                <div style={{fontSize:11,fontWeight:700,color:col}}>{v}</div>
              </div>
            ))}
          </div>
        </div>
        {top5.map(b=>(
          <div key={b.id} style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'8px 0',borderBottom:`1px solid ${C.border}`}}>
            <div style={{minWidth:0,flex:1}}>
              <div style={{fontSize:13,fontWeight:500,color:C.text,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{b.clients?.name?.split('/')[0].trim()||'—'}</div>
              <div style={{fontSize:11,color:C.muted}}>{b.invoice_no||'—'} · {fmtDate(b.due)}</div>
            </div>
            <div style={{textAlign:'right',flexShrink:0,marginLeft:12}}>
              <div style={{fontSize:13,fontWeight:600,color:b.status==='Vencido'?C.overdue:C.text}}>{fmt(b.amount)}</div>
              <DaysBadge due={b.due} status={b.status}/>
            </div>
          </div>
        ))}
      </div>

      {negatives.length>0&&(
        <div style={{padding:'16px 20px 0'}}>
          <div style={{background:'#FBE9E7',borderRadius:10,padding:'12px 14px',border:`1px solid #f5c6c2`}}>
            <div style={{fontSize:11,fontWeight:600,color:C.overdue,marginBottom:6}}>Fondos negativos</div>
            {negatives.map(c=>(
              <div key={c.id} style={{display:'flex',justifyContent:'space-between',fontSize:12,color:C.text,marginBottom:2}}>
                <span>{c.name}</span><span style={{fontWeight:600,color:C.overdue}}>{fmt(balances[c.id])}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {tasks?.filter(t=>t.status==='Activo').length>0&&(
        <div style={{padding:'16px 20px 0'}}>
          <div style={{fontSize:11,fontWeight:600,color:C.muted,textTransform:'uppercase',letterSpacing:.5,marginBottom:8}}>Tareas por persona</div>
          <TasksByPerson tasks={tasks} clients={clients}/>
        </div>
      )}
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

function SaleForm({sale,clients,onSave,onClose,onDelete,saving}) {
  const MONTHS = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre']
  const [f,setF] = useState(sale||{client_id:'',title:'',area:'Corporativo',amount_uf:'',uf_value:'',year:currentYear,month:currentMonth,status:'Activo',notes:''})
  const up=(k,v)=>setF(p=>({...p,[k]:v}))
  return (
    <>
      <Fld label='Cliente'>
        <select value={f.client_id||''} onChange={e=>up('client_id',e.target.value)} style={{width:'100%',padding:'10px 12px',borderRadius:8,border:`1px solid ${C.border}`,background:'#F7F7F7',color:C.text,fontSize:14,boxSizing:'border-box'}}>
          <option value=''>— Seleccionar —</option>
          {clients.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </Fld>
      <Fld label='Descripcion'><Inp value={f.title||''} onChange={e=>up('title',e.target.value)} placeholder='Ej: Reorganizacion societaria...'/></Fld>
      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10}}>
        <Fld label='Area'><Sel value={f.area||'Corporativo'} onChange={e=>up('area',e.target.value)} options={['Corporativo','Tributario','Laboral','Otro']}/></Fld>
        <Fld label='Estado'><Sel value={f.status||'Activo'} onChange={e=>up('status',e.target.value)} options={['Activo','Terminado','Pausado']}/></Fld>
        <Fld label='Honorarios UF'><Inp type='number' step='0.01' value={f.amount_uf||''} onChange={e=>up('amount_uf',e.target.value)} placeholder='0.00'/></Fld>
        <Fld label='Valor UF (CLP)'><Inp type='number' value={f.uf_value||''} onChange={e=>up('uf_value',e.target.value)} placeholder='Ej: 38500'/></Fld>
        <Fld label='Ano presupuesto'><Inp type='number' value={f.year||currentYear} onChange={e=>up('year',parseInt(e.target.value))} placeholder={String(currentYear)}/></Fld>
        <Fld label='Mes'>
          <select value={f.month||currentMonth} onChange={e=>up('month',parseInt(e.target.value))} style={{width:'100%',padding:'10px 12px',borderRadius:8,border:`1px solid ${C.border}`,background:'#F7F7F7',color:C.text,fontSize:14,boxSizing:'border-box'}}>
            {MONTHS.map((m,i)=><option key={i+1} value={i+1}>{m}</option>)}
          </select>
        </Fld>
      </div>
      <Fld label='Notas'><Txt value={f.notes||''} onChange={e=>up('notes',e.target.value)} placeholder='Observaciones...'/></Fld>
      <div style={{display:'flex',gap:8,marginTop:4}}>
        {sale?.id&&<button onClick={()=>onDelete(sale.id)} style={{padding:'11px 14px',borderRadius:10,border:`1px solid ${C.overdue}`,background:'transparent',color:C.overdue,fontSize:13,fontWeight:600,cursor:'pointer'}}>Eliminar</button>}
        <button onClick={onClose} style={{flex:1,padding:11,borderRadius:10,border:`1px solid ${C.border}`,background:'transparent',color:C.muted,fontSize:13,fontWeight:600,cursor:'pointer'}}>Cancelar</button>
        <button disabled={saving||!f.client_id||!f.title} onClick={()=>onSave(f)} style={{flex:2,padding:11,borderRadius:10,border:'none',background:C.accent,color:'#fff',fontSize:13,fontWeight:700,cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center',gap:8,opacity:(!f.client_id||!f.title)?.6:1}}>
          {saving?<Spin/>:null}{saving?'Guardando...':'Guardar'}
        </button>
      </div>
    </>
  )
}

// ─── BILLING VIEW ─────────────────────────────────────────────────────────────
function BillingView({billing,clients,hideErasmo,onStatusChange,onAdd,onEdit,onImport}) {
  const [filter,setFilter] = useState('activo')
  const [fYear,setFYear] = useState('')
  const bb = hideErasmo ? billing.filter(b=>!b.erasmo) : billing
  const filtered = useMemo(()=>{
    let r = bb
    if(filter==='activo') r = r.filter(b=>['Pendiente','Vencido','Propuesta'].includes(b.status))
    else if(filter==='pagado') r = r.filter(b=>b.status==='Pagado')
    if(fYear) r = r.filter(b=>b.issued_at?.startsWith(fYear))
    return r.sort((a,b)=>new Date(b.issued_at||0)-new Date(a.issued_at||0))
  },[bb,filter,fYear])
  const pending=bb.filter(b=>b.status==='Pendiente').reduce((s,b)=>s+(b.amount||0),0)
  const overdue=bb.filter(b=>b.status==='Vencido').reduce((s,b)=>s+(b.amount||0),0)
  const paid=bb.filter(b=>b.status==='Pagado').reduce((s,b)=>s+(b.amount||0),0)
  const years=[...new Set(bb.map(b=>b.issued_at?.slice(0,4)).filter(Boolean))].sort((a,b)=>b-a)
  return (
    <div>
      <div style={{padding:'20px 20px 0',position:'sticky',top:0,background:C.bg,zIndex:10}}>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:12}}>
          <div style={{fontSize:20,fontWeight:600,color:C.text,fontFamily:"'DM Sans',sans-serif",letterSpacing:-.4}}>Cobros</div>
          <div style={{display:'flex',gap:6}}>
            <button onClick={onImport} style={{padding:'6px 12px',borderRadius:8,border:`1px solid ${C.border}`,background:'#fff',color:C.accent,fontSize:12,fontWeight:600,cursor:'pointer'}}>Drive</button>
            <button onClick={onAdd} style={{padding:'6px 12px',borderRadius:8,border:`1px solid ${C.accent}`,background:C.accent,color:'#fff',fontSize:12,fontWeight:600,cursor:'pointer'}}>+ Nuevo</button>
          </div>
        </div>
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:8,marginBottom:10}}>
          {[['Por cobrar',fmt(pending),'#E3EEF3',C.accent],['Vencido',fmt(overdue),'#FBE9E7',C.overdue],['Cobrado',fmt(paid),'#E4F1EA',C.normal]].map(([l,v,bg,col])=>(
            <div key={l} style={{background:bg,borderRadius:10,padding:'10px 12px',border:`1px solid ${C.border}`}}>
              <div style={{fontSize:10,color:C.muted,marginBottom:3,textTransform:'uppercase',letterSpacing:.4}}>{l}</div>
              <div style={{fontSize:13,fontWeight:700,color:col}}>{v}</div>
            </div>
          ))}
        </div>
        <div style={{display:'flex',gap:6,marginBottom:6}}>
          {[['activo','Pendientes'],['pagado','Pagados'],['all','Todos']].map(([v,l])=>(
            <button key={v} onClick={()=>setFilter(v)} style={{flex:1,padding:'7px 0',borderRadius:8,border:`1px solid ${filter===v?C.accent:C.border}`,background:filter===v?'#E6EEF1':'transparent',color:filter===v?C.accent:C.muted,fontSize:12,fontWeight:600,cursor:'pointer'}}>{l}</button>
          ))}
        </div>
        {years.length>0&&(
          <select value={fYear} onChange={e=>setFYear(e.target.value)} style={{width:'100%',padding:'7px 10px',borderRadius:8,border:`1px solid ${C.border}`,background:'#F7F7F7',color:C.text,fontSize:12,marginBottom:4}}>
            <option value=''>Todos los anos</option>
            {years.map(y=><option key={y} value={y}>{y}</option>)}
          </select>
        )}
      </div>
      <div style={{padding:'10px 20px 100px'}}>
        {filtered.length===0&&<div style={{color:C.muted,textAlign:'center',padding:40}}>Sin cobros</div>}
        {filtered.map(b=>(
          <div key={b.id} style={{background:C.card,borderRadius:10,padding:'12px 14px',marginBottom:8,border:`1px solid ${C.border}`}}>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:6}}>
              <div style={{minWidth:0,flex:1}}>
                <div style={{fontSize:13,fontWeight:600,color:C.text,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{b.clients?.name?.split('/')[0].trim()||'—'}</div>
                <div style={{fontSize:11,color:C.muted,marginTop:1}}>{b.concept}</div>
              </div>
              <div style={{display:'flex',alignItems:'center',gap:8,flexShrink:0,marginLeft:12}}>
                <div style={{fontSize:15,fontWeight:600,color:b.status==='Vencido'?C.overdue:C.text}}>{fmt(b.amount)}</div>
                <button onClick={()=>onEdit(b)} style={{background:'none',border:`1px solid ${C.border}`,borderRadius:6,padding:'3px 8px',fontSize:11,color:C.muted,cursor:'pointer'}}>edit</button>
              </div>
            </div>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
              <div style={{display:'flex',gap:6,alignItems:'center'}}>
                <span style={{fontSize:11,color:C.muted,fontFamily:'monospace'}}>{b.invoice_no||'—'}</span>
                <span style={{fontSize:11,color:C.muted}}>· {fmtDate(b.issued_at)}</span>
                {b.status!=='Pagado'&&<DaysBadge due={b.due} status={b.status}/>}
                {b.status==='Pagado'&&b.paid_at&&<span style={{fontSize:10,color:C.normal,fontWeight:600}}>Pagado {fmtDate(b.paid_at)}</span>}
              </div>
              <select value={b.status} onChange={e=>onStatusChange(b.id,e.target.value)} style={{padding:'3px 8px',borderRadius:6,border:`1px solid ${C.border}`,background:'#F7F7F7',color:C.accent,fontSize:11,fontWeight:600,cursor:'pointer'}}>
                {['Propuesta','Pendiente','Pagado','Vencido','Anulado'].map(s=><option key={s} value={s}>{s}</option>)}
              </select>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function BillingForm({bill,clients,onSave,onClose,saving}) {
  const [f,setF] = useState(bill||{client_id:'',concept:'',amount:'',status:'Pendiente',invoice_no:'',issued_at:'',due:'',paid_at:'',notes:'',erasmo:false})
  const up=(k,v)=>setF(p=>({...p,[k]:v}))
  return (
    <>
      <Fld label='Cliente'>
        <select value={f.client_id||''} onChange={e=>up('client_id',e.target.value)} style={{width:'100%',padding:'10px 12px',borderRadius:8,border:`1px solid ${C.border}`,background:'#F7F7F7',color:C.text,fontSize:14,boxSizing:'border-box'}}>
          <option value=''>— Seleccionar —</option>
          {clients.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </Fld>
      <Fld label='Concepto'><Inp value={f.concept||''} onChange={e=>up('concept',e.target.value)} placeholder='Descripcion del cobro...'/></Fld>
      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10}}>
        <Fld label='Monto (CLP)'><Inp type='number' value={f.amount||''} onChange={e=>up('amount',e.target.value)} placeholder='0'/></Fld>
        <Fld label='Estado'><Sel value={f.status||'Pendiente'} onChange={e=>up('status',e.target.value)} options={['Propuesta','Pendiente','Pagado','Vencido','Anulado']}/></Fld>
        <Fld label='N Factura'><Inp value={f.invoice_no||''} onChange={e=>up('invoice_no',e.target.value)} placeholder='F-001...'/></Fld>
        <Fld label='Emision'><Inp type='date' value={f.issued_at||''} onChange={e=>up('issued_at',e.target.value)}/></Fld>
        <Fld label='Vencimiento'><Inp type='date' value={f.due||''} onChange={e=>up('due',e.target.value)}/></Fld>
        {f.status==='Pagado'&&<Fld label='Fecha de pago'><Inp type='date' value={f.paid_at||''} onChange={e=>up('paid_at',e.target.value)}/></Fld>}
      </div>
      <Fld label='Notas'><Txt value={f.notes||''} onChange={e=>up('notes',e.target.value)} placeholder='Observaciones...'/></Fld>
      <Fld label='Cartera'>
        <button type='button' onClick={()=>up('erasmo',!f.erasmo)} style={{padding:'9px 14px',borderRadius:8,border:`1px solid ${f.erasmo?C.accent:C.border}`,background:f.erasmo?'#E6EEF1':'transparent',color:f.erasmo?C.accent:C.muted,fontSize:13,fontWeight:600,cursor:'pointer'}}>
          {f.erasmo?'Cobro de Erasmo':'Marcar como Erasmo'}
        </button>
      </Fld>
      <div style={{display:'flex',gap:8,marginTop:4}}>
        <button onClick={onClose} style={{flex:1,padding:11,borderRadius:10,border:`1px solid ${C.border}`,background:'transparent',color:C.muted,fontSize:13,fontWeight:600,cursor:'pointer'}}>Cancelar</button>
        <button disabled={saving||!f.client_id||!f.concept} onClick={()=>onSave(f)} style={{flex:2,padding:11,borderRadius:10,border:'none',background:C.accent,color:'#fff',fontSize:13,fontWeight:700,cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center',gap:8,opacity:(!f.client_id||!f.concept)?.6:1}}>
          {saving?<Spin/>:null}{saving?'Guardando...':'Guardar'}
        </button>
      </div>
    </>
  )
}

// ─── EXPENSES VIEW ────────────────────────────────────────────────────────────
function ExpensesView({expenses,clients,sales,onAdd,onEdit}) {
  const [fClient,setFClient] = useState('')
  const filtered = useMemo(()=>{
    let r = fClient ? expenses.filter(e=>e.client_id===fClient) : expenses
    return r.sort((a,b)=>new Date(b.date||0)-new Date(a.date||0))
  },[expenses,fClient])
  const balances = useMemo(()=>{
    const m={}; expenses.forEach(e=>{ m[e.client_id]=(m[e.client_id]||0)+(e.type==='fondo'?e.amount:-e.amount) }); return m
  },[expenses])
  const totalFondos=expenses.filter(e=>e.type==='fondo').reduce((a,e)=>a+e.amount,0)
  const totalGastos=expenses.filter(e=>e.type==='gasto').reduce((a,e)=>a+e.amount,0)
  const negatives=clients.filter(c=>balances[c.id]<0)
  return (
    <div>
      <div style={{padding:'20px 20px 10px',position:'sticky',top:0,background:C.bg,zIndex:10}}>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:10}}>
          <div style={{fontSize:20,fontWeight:600,color:C.text,fontFamily:"'DM Sans',sans-serif",letterSpacing:-.4}}>Gastos y Fondos</div>
          <button onClick={onAdd} style={{padding:'6px 14px',borderRadius:8,border:`1px solid ${C.accent}`,background:C.accent,color:'#fff',fontSize:12,fontWeight:600,cursor:'pointer'}}>+ Nuevo</button>
        </div>
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8,marginBottom:10}}>
          <div style={{background:'#E4F1EA',borderRadius:9,padding:'8px 12px',border:`1px solid ${C.border}`}}>
            <div style={{fontSize:10,color:C.muted,marginBottom:2}}>FONDOS RECIBIDOS</div>
            <div style={{fontSize:13,fontWeight:700,color:C.normal}}>{fmt(totalFondos)}</div>
          </div>
          <div style={{background:'#FBE9E7',borderRadius:9,padding:'8px 12px',border:`1px solid ${C.border}`}}>
            <div style={{fontSize:10,color:C.muted,marginBottom:2}}>GASTOS REALIZADOS</div>
            <div style={{fontSize:13,fontWeight:700,color:C.overdue}}>{fmt(totalGastos)}</div>
          </div>
        </div>
        {negatives.length>0&&(
          <div style={{background:'#FBE9E7',borderRadius:8,padding:'8px 12px',marginBottom:8,border:`1px solid #f5c6c2`}}>
            <div style={{fontSize:11,fontWeight:600,color:C.overdue,marginBottom:4}}>Saldo negativo</div>
            {negatives.map(c=>(
              <div key={c.id} style={{fontSize:12,color:C.text,display:'flex',justifyContent:'space-between'}}>
                <span>{c.name}</span><span style={{fontWeight:600,color:C.overdue}}>{fmt(balances[c.id])}</span>
              </div>
            ))}
          </div>
        )}
        <select value={fClient} onChange={e=>setFClient(e.target.value)} style={{width:'100%',padding:'7px 10px',borderRadius:8,border:`1px solid ${C.border}`,background:'#F7F7F7',color:C.text,fontSize:12}}>
          <option value=''>Todos los clientes</option>
          {clients.map(c=><option key={c.id} value={c.id}>{c.name} {balances[c.id]?`(${fmt(balances[c.id])})`:''}</option>)}
        </select>
      </div>
      <div style={{padding:'10px 20px 100px'}}>
        {filtered.length===0&&<div style={{color:C.muted,textAlign:'center',padding:40}}>Sin registros</div>}
        {filtered.map(e=>{
          const client=clients.find(c=>c.id===e.client_id)
          const sale=sales.find(s=>s.id===e.sale_id)
          const isFondo=e.type==='fondo'
          return (
            <div key={e.id} onClick={()=>onEdit(e)} style={{background:C.card,borderRadius:10,padding:'12px 14px',marginBottom:8,border:`1px solid ${C.border}`,borderLeft:`3px solid ${isFondo?C.normal:C.overdue}`,cursor:'pointer'}}
              onMouseEnter={x=>x.currentTarget.style.boxShadow='0 2px 12px rgba(0,0,0,.08)'}
              onMouseLeave={x=>x.currentTarget.style.boxShadow='none'}>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start'}}>
                <div style={{minWidth:0,flex:1}}>
                  <div style={{fontSize:13,fontWeight:600,color:C.text,marginBottom:2}}>{e.concept||'Sin descripcion'}</div>
                  <div style={{fontSize:11,color:C.muted}}>{client?.name||'—'}{sale?` · ${sale.title}`:''}</div>
                  <div style={{fontSize:11,color:C.muted,marginTop:2}}>{fmtDate(e.date)}</div>
                </div>
                <div style={{textAlign:'right',flexShrink:0,marginLeft:12}}>
                  <div style={{fontSize:14,fontWeight:700,color:isFondo?C.normal:C.overdue}}>{isFondo?'+':'-'}{fmt(e.amount)}</div>
                  <Pill label={isFondo?'Fondo':'Gasto'} bg={isFondo?'#E4F1EA':'#FBE9E7'} color={isFondo?C.normal:C.overdue} small/>
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function ExpenseForm({expense,clients,sales,onSave,onClose,onDelete,saving}) {
  const [f,setF] = useState(expense||{client_id:'',sale_id:'',type:'fondo',amount:'',concept:'',date:new Date().toISOString().slice(0,10)})
  const up=(k,v)=>setF(p=>({...p,[k]:v}))
  const clientSales=sales.filter(s=>s.client_id===f.client_id)
  return (
    <>
      <Fld label='Tipo'>
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8}}>
          {[['fondo','+ Fondo recibido',C.normal,'#E4F1EA'],['gasto','- Gasto realizado',C.overdue,'#FBE9E7']].map(([v,l,col,bg])=>(
            <button key={v} type='button' onClick={()=>up('type',v)} style={{padding:'10px',borderRadius:8,border:`2px solid ${f.type===v?col:C.border}`,background:f.type===v?bg:'transparent',color:f.type===v?col:C.muted,fontSize:12,fontWeight:700,cursor:'pointer'}}>{l}</button>
          ))}
        </div>
      </Fld>
      <Fld label='Cliente'>
        <select value={f.client_id||''} onChange={e=>up('client_id',e.target.value)} style={{width:'100%',padding:'10px 12px',borderRadius:8,border:`1px solid ${C.border}`,background:'#F7F7F7',color:C.text,fontSize:14,boxSizing:'border-box'}}>
          <option value=''>— Seleccionar —</option>
          {clients.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </Fld>
      {clientSales.length>0&&(
        <Fld label='Venta asociada (opcional)'>
          <select value={f.sale_id||''} onChange={e=>up('sale_id',e.target.value)} style={{width:'100%',padding:'10px 12px',borderRadius:8,border:`1px solid ${C.border}`,background:'#F7F7F7',color:C.text,fontSize:14,boxSizing:'border-box'}}>
            <option value=''>— General del cliente —</option>
            {clientSales.map(s=><option key={s.id} value={s.id}>{s.title}</option>)}
          </select>
        </Fld>
      )}
      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10}}>
        <Fld label='Monto (CLP)'><Inp type='number' value={f.amount||''} onChange={e=>up('amount',e.target.value)} placeholder='0'/></Fld>
        <Fld label='Fecha'><Inp type='date' value={f.date||''} onChange={e=>up('date',e.target.value)}/></Fld>
      </div>
      <Fld label='Concepto'><Inp value={f.concept||''} onChange={e=>up('concept',e.target.value)} placeholder='Ej: Gastos notaria, fondo inicial...'/></Fld>
      <div style={{display:'flex',gap:8,marginTop:4}}>
        {expense?.id&&<button onClick={()=>onDelete(expense.id)} style={{padding:'11px 14px',borderRadius:10,border:`1px solid ${C.overdue}`,background:'transparent',color:C.overdue,fontSize:13,fontWeight:600,cursor:'pointer'}}>Eliminar</button>}
        <button onClick={onClose} style={{flex:1,padding:11,borderRadius:10,border:`1px solid ${C.border}`,background:'transparent',color:C.muted,fontSize:13,fontWeight:600,cursor:'pointer'}}>Cancelar</button>
        <button disabled={saving||!f.client_id||!f.amount} onClick={()=>onSave(f)} style={{flex:2,padding:11,borderRadius:10,border:'none',background:C.accent,color:'#fff',fontSize:13,fontWeight:700,cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center',gap:8,opacity:(!f.client_id||!f.amount)?.6:1}}>
          {saving?<Spin/>:null}{saving?'Guardando...':'Guardar'}
        </button>
      </div>
    </>
  )
}

// ─── CLIENTS VIEW ─────────────────────────────────────────────────────────────
function QuickTaskForm({clients,sales,onSave,onClose,saving}) {
  const [q,setQ] = useState('')
  const [selectedClient,setSelectedClient] = useState(null)
  const [f,setF] = useState({title:'',who:'Cristóbal',due:'',status:'Activo',note:'',sale_id:''})
  const up=(k,v)=>setF(p=>({...p,[k]:v}))
  const WHO = ['Cristóbal','Martín','Erasmo','Rodrigo','Martina']
  const MONTHS = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic']

  const matches = useMemo(()=>{
    if(!q.trim()) return []
    const ql = q.toLowerCase()
    return clients.filter(c=>c.name.toLowerCase().includes(ql)).slice(0,6)
  },[clients,q])

  const clientSales = sales.filter(s=>s.client_id===selectedClient?.id&&s.status==='Activo')

  return (
    <>
      {!selectedClient ? (
        <Fld label='Cliente'>
          <div style={{position:'relative'}}>
            <Inp
              value={q}
              onChange={e=>setQ(e.target.value)}
              placeholder='Escribe para buscar cliente...'
              autoFocus
            />
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
          <button onClick={()=>{setSelectedClient(null);setF(p=>({...p,sale_id:''}))}} style={{background:'none',border:'none',color:C.muted,fontSize:13,cursor:'pointer'}}>Cambiar</button>
        </div>
      )}

      {selectedClient&&(
        <>
          <Fld label='Tarea'><Inp value={f.title} onChange={e=>up('title',e.target.value)} placeholder='Descripción de la tarea...' autoFocus/></Fld>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10}}>
            <Fld label='Responsable'><Sel value={f.who} onChange={e=>up('who',e.target.value)} options={WHO}/></Fld>
            <Fld label='Plazo'><Inp type='date' value={f.due} onChange={e=>up('due',e.target.value)}/></Fld>
          </div>
          {clientSales.length>0&&(
            <Fld label='Venta asociada (opcional)'>
              <select value={f.sale_id} onChange={e=>up('sale_id',e.target.value)} style={{width:'100%',padding:'10px 12px',borderRadius:8,border:`1px solid ${C.border}`,background:'#F7F7F7',color:C.text,fontSize:14,boxSizing:'border-box'}}>
                <option value=''>— Sin venta —</option>
                {clientSales.map(s=><option key={s.id} value={s.id}>{s.title}</option>)}
              </select>
            </Fld>
          )}
          <Fld label='Nota'><Inp value={f.note} onChange={e=>up('note',e.target.value)} placeholder='Contexto adicional...'/></Fld>
        </>
      )}

      <div style={{display:'flex',gap:8,marginTop:4}}>
        <button onClick={onClose} style={{flex:1,padding:11,borderRadius:10,border:`1px solid ${C.border}`,background:'transparent',color:C.muted,fontSize:13,fontWeight:600,cursor:'pointer'}}>Cancelar</button>
        <button disabled={saving||!selectedClient||!f.title.trim()} onClick={()=>onSave({...f,client_id:selectedClient.id,sale_id:f.sale_id||null})}
          style={{flex:2,padding:11,borderRadius:10,border:'none',background:C.accent,color:'#fff',fontSize:13,fontWeight:700,cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center',gap:8,opacity:(!selectedClient||!f.title.trim())?.6:1}}>
          {saving?<Spin/>:null}{saving?'Guardando...':'Guardar tarea'}
        </button>
      </div>
    </>
  )
}

function ClientsView({clients,sales,billing,expenses,onEdit,onAdd,onAddTask}) {
  const [sFilter,setSFilter] = useState('Activo')
  const [q,setQ] = useState('')
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
  return (
    <div>
      <div style={{padding:'20px 20px 0',position:'sticky',top:0,background:C.bg,zIndex:10}}>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
          <div style={{fontSize:20,fontWeight:600,color:C.text,fontFamily:"'DM Sans',sans-serif",letterSpacing:-.4}}>Clientes</div>
          <div style={{display:'flex',gap:6}}>
            <button onClick={onAdd} style={{padding:'6px 12px',borderRadius:8,border:`1px solid ${C.border}`,background:'#fff',color:C.text,fontSize:12,fontWeight:600,cursor:'pointer'}}>+ Cliente</button>
            <button onClick={onAddTask} style={{padding:'6px 14px',borderRadius:8,border:'none',background:C.accent,color:'#fff',fontSize:12,fontWeight:600,cursor:'pointer'}}>+ Tarea</button>
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
            <div key={c.id} onClick={()=>onEdit(c)} style={{background:C.card,borderRadius:10,padding:'13px 16px',marginBottom:8,border:`1px solid ${C.border}`,borderLeft:`3px solid ${ended?C.done:hasOverdue?C.overdue:C.accent}`,opacity:ended?.7:1,cursor:'pointer'}}
              onMouseEnter={e=>e.currentTarget.style.boxShadow='0 2px 12px rgba(0,0,0,.09)'}
              onMouseLeave={e=>e.currentTarget.style.boxShadow='none'}>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',gap:8,marginBottom:4}}>
                <div style={{minWidth:0}}>
                  <div style={{fontSize:14,fontWeight:600,color:C.text,marginBottom:2}}>{c.name}</div>
                  <div style={{fontSize:11,color:C.muted}}>{c.type}</div>
                </div>
                {ended&&<Pill label='Terminado' bg='#ECECEC' color={C.muted} small/>}
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

// ─── CLIENT FORM ──────────────────────────────────────────────────────────────
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
  const [form,setForm] = useState(null) // null=cerrado, {}=nuevo, {id,...}=editar
  const [busy,setBusy] = useState(false)
  const WHO = ['Cristóbal','Martín','Erasmo','Rodrigo','Martina']

  useEffect(()=>{
    let ok=true
    supabase.from('tasks').select('*').eq('client_id',clientId).order('due',{ascending:true,nullsFirst:false})
      .then(({data})=>ok&&setTasks(data||[]))
    return ()=>{ok=false}
  },[clientId])

  const save = async()=>{
    if(!form.title?.trim()) return
    setBusy(true)
    try{
      const p={...form,client_id:clientId,sale_id:form.sale_id||null}
      const{data,error}=await supabase.from('tasks').upsert(p).select().single()
      if(error)throw error
      setTasks(p=>form.id?p.map(x=>x.id===data.id?data:x):[...p,data])
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

  return (
    <div style={{marginBottom:14,padding:14,borderRadius:10,border:`1px solid ${C.border}`,background:'#FAFAFA'}}>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:8}}>
        <Lbl>Tareas</Lbl>
        <button onClick={()=>setForm({title:'',who:'Cristóbal',due:'',status:'Activo',note:'',sale_id:''})} style={{padding:'3px 10px',borderRadius:6,border:`1px solid ${C.accent}`,background:'transparent',color:C.accent,fontSize:11,fontWeight:600,cursor:'pointer'}}>+ Agregar</button>
      </div>
      {tasks===null&&<div style={{fontSize:12,color:C.muted}}>Cargando...</div>}
      {tasks?.length===0&&!form&&<div style={{fontSize:12,color:C.muted}}>Sin tareas.</div>}

      {form&&(
        <div style={{background:'#fff',borderRadius:8,padding:12,marginBottom:10,border:`1px solid ${C.border}`}}>
          <input value={form.title||''} onChange={e=>setForm(p=>({...p,title:e.target.value}))} placeholder='Descripción de la tarea...' style={{width:'100%',padding:'8px 10px',borderRadius:7,border:`1px solid ${C.border}`,fontSize:13,marginBottom:8,boxSizing:'border-box'}}/>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8,marginBottom:8}}>
            <select value={form.who||'Cristóbal'} onChange={e=>setForm(p=>({...p,who:e.target.value}))} style={{padding:'7px 10px',borderRadius:7,border:`1px solid ${C.border}`,fontSize:12,background:'#F7F7F7'}}>
              {WHO.map(w=><option key={w} value={w}>{w}</option>)}
            </select>
            <input type='date' value={form.due||''} onChange={e=>setForm(p=>({...p,due:e.target.value}))} style={{padding:'7px 10px',borderRadius:7,border:`1px solid ${C.border}`,fontSize:12,background:'#F7F7F7'}}/>
          </div>
          {sales?.filter(s=>s.client_id===clientId).length>0&&(
            <select value={form.sale_id||''} onChange={e=>setForm(p=>({...p,sale_id:e.target.value}))} style={{width:'100%',padding:'7px 10px',borderRadius:7,border:`1px solid ${C.border}`,fontSize:12,background:'#F7F7F7',marginBottom:8}}>
              <option value=''>— Sin venta asociada —</option>
              {sales.filter(s=>s.client_id===clientId).map(s=><option key={s.id} value={s.id}>{s.title}</option>)}
            </select>
          )}
          <input value={form.note||''} onChange={e=>setForm(p=>({...p,note:e.target.value}))} placeholder='Nota (opcional)...' style={{width:'100%',padding:'7px 10px',borderRadius:7,border:`1px solid ${C.border}`,fontSize:12,marginBottom:8,boxSizing:'border-box'}}/>
          <div style={{display:'flex',gap:6}}>
            <button onClick={()=>setForm(null)} style={{flex:1,padding:'7px',borderRadius:7,border:`1px solid ${C.border}`,background:'transparent',color:C.muted,fontSize:12,cursor:'pointer'}}>Cancelar</button>
            <button onClick={save} disabled={busy||!form.title?.trim()} style={{flex:2,padding:'7px',borderRadius:7,border:'none',background:C.accent,color:'#fff',fontSize:12,fontWeight:600,cursor:'pointer',opacity:!form.title?.trim()?.6:1}}>
              {busy?'Guardando...':'Guardar'}
            </button>
          </div>
        </div>
      )}

      {active.map(t=>(
        <div key={t.id} style={{display:'flex',gap:8,alignItems:'flex-start',padding:'8px 0',borderBottom:`1px solid ${C.border}`}}>
          <button onClick={()=>toggle(t)} style={{width:18,height:18,borderRadius:4,border:`2px solid ${C.accent}`,background:'transparent',cursor:'pointer',flexShrink:0,marginTop:1}}/>
          <div style={{flex:1,minWidth:0}}>
            <div style={{fontSize:13,color:C.text,fontWeight:500}}>{t.title}</div>
            <div style={{fontSize:11,color:C.muted,display:'flex',gap:6,flexWrap:'wrap',marginTop:2}}>
              <span>{t.who||'—'}</span>
              {t.due&&<><span>·</span><DaysBadge due={t.due} status={t.status}/></>}
              {t.note&&<><span>·</span><span style={{overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{t.note}</span></>}
            </div>
          </div>
          <button onClick={()=>setForm({...t})} style={{background:'none',border:'none',color:C.muted,fontSize:12,cursor:'pointer',flexShrink:0}}>ed</button>
          <button onClick={()=>del(t.id)} style={{background:'none',border:'none',color:C.overdue,fontSize:12,cursor:'pointer',flexShrink:0}}>x</button>
        </div>
      ))}

      {done.length>0&&(
        <div style={{marginTop:8}}>
          <div style={{fontSize:10,color:C.muted,fontWeight:600,textTransform:'uppercase',letterSpacing:.5,marginBottom:4}}>Completadas ({done.length})</div>
          {done.map(t=>(
            <div key={t.id} style={{display:'flex',gap:8,alignItems:'center',padding:'5px 0'}}>
              <button onClick={()=>toggle(t)} style={{width:18,height:18,borderRadius:4,border:`2px solid ${C.done}`,background:C.done,cursor:'pointer',flexShrink:0,fontSize:10,color:'#fff',display:'flex',alignItems:'center',justifyContent:'center'}}>✓</button>
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
  const [f,setF]=useState(client||{name:'',type:'',email:'',phone:'',contact:'',erasmo:false,status:'Activo',ended_at:'',notes:''})
  const up=(k,v)=>setF(p=>({...p,[k]:v}))
  return (
    <>
      <Fld label='Nombre'><Inp value={f.name||''} onChange={e=>up('name',e.target.value)} placeholder='Nombre del cliente...'/></Fld>
      <Fld label='Tipo'><Sel value={f.type||''} onChange={e=>up('type',e.target.value)} options={['Corporativo','Tributario','Laboral']} placeholder='— Seleccionar —'/></Fld>
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
  const t=raw.replace(/\r\n/g,'\n').replace(/\r/g,'\n')
  const fm0=t.match(/N[°º.\s]{0,3}(\d+)/)
  const folio=fm0?fm0[1]:null
  const cm=t.match(/SE[ÑN]OR(?:\(ES\))?[:\s]+(.+?)\s*\nR\.U\.T\.?[:\s]+([\d.]{6,12}[\-\s]*[\dkK])/i)
  const cliente=cm?cm[1].trim():null
  const rut=cm?cm[2].replace(/\s+/g,''):null
  let issued_at=null
  const fm=t.match(/Fecha\s*Emis[io]{1,2}n[:\s]*(\d{1,2})\s+de\s+(\w+)\s+del?\s+(\d{4})/i)
  if(fm){const dia=+fm[1],mes=MESES[fm[2].toLowerCase()],anio=+fm[3];if(mes)issued_at=`${anio}-${String(mes).padStart(2,'0')}-${String(dia).padStart(2,'0')}`}
  const tm=t.match(/TOTAL[\s\S]{0,10}?([\d][\d.]{2,})/)
  const total=tm?parseInt(tm[1].replace(/\./g,''),10):null
  let concepto=null
  const gm=t.match(/(?:Descripcion|Descripción)[\s\S]{0,300}?\n([^\n]{5,120})\n/)
  if(gm)concepto=gm[1].replace(/\s+/g,' ').trim()||null
  if(!concepto){const gm2=t.match(/Valor\s*\n([\s\S]*?)Forma de Pago/);if(gm2)concepto=gm2[1].replace(/\s+/g,' ').replace(/^[-\s]+/,'').replace(/\s*[\d.]+\s*$/,'').trim()||null}
  return{folio,cliente,rut,issued_at,total,concepto}
}
const FACTURACION_ROOT='1GtcDmnq2FpGQlaZRETyOU4Zwf5MfCi7V'
async function driveGet(token,url){
  const fullUrl=url+(url.includes('?')?'&':'?')+'supportsAllDrives=true&includeItemsFromAllDrives=true'
  const r=await fetch(fullUrl,{headers:{Authorization:'Bearer '+token}})
  if(!r.ok) throw new Error('Drive API error '+r.status)
  return r.json()
}
function DriveImporter({clients,billing,onImported,onClose}){
  const [step,setStep]=useState('init')
  const [token,setToken]=useState(null)
  const [years,setYears]=useState([])
  const [months,setMonths]=useState([])
  const [selYear,setSelYear]=useState(null)
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
          const pdfjsLib=await import('https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js')
          pdfjsLib.GlobalWorkerOptions.workerSrc='https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js'
          const pdfDoc=await pdfjsLib.getDocument({data:arrayBuf}).promise
          for(let p=1;p<=pdfDoc.numPages;p++){const page=await pdfDoc.getPage(p);const tc=await page.getTextContent();raw+=tc.items.map(i=>i.str).join(' ')+'\n'}
        }catch(e){raw=new TextDecoder('latin1').decode(arrayBuf)}
        const parsed=parseInvoice(raw)
        const exists=billing.some(b=>b.invoice_no===parsed.folio)
        if(exists){results.skipped++;addLog(`skip ${pdf.name}`);setProgress(p=>({...p,done:p.done+1}));continue}
        let mc=null
        if(parsed.rut)mc=clients.find(c=>c.rut===parsed.rut)
        if(!mc&&parsed.cliente)mc=clients.find(c=>c.name?.toLowerCase()===parsed.cliente?.toLowerCase())
        if(parsed.folio&&parsed.total){
          try{await upsertBilling({client_id:mc?.id||null,concept:parsed.concepto||parsed.cliente||pdf.name,amount:parsed.total,status:'Pendiente',invoice_no:parsed.folio,issued_at:parsed.issued_at,due:parsed.issued_at,notes:`Drive: ${pdf.name}`,erasmo:false})}
          catch(e){addLog(`error guardando ${pdf.name}: ${e.message}`)}
        }
        results.rows.push({...parsed,clientMatch:mc,fileName:pdf.name});results.imported++
        addLog(`ok ${pdf.name} — ${parsed.cliente||'?'} · $${parsed.total?.toLocaleString('es-CL')||'?'}`)
      }catch(e){results.errors++;addLog(`error ${pdf.name}: ${e.message}`)}
      setProgress(p=>({...p,done:p.done+1}))
    }
    addLog('—————————————————————————')
    addLog(`${results.imported} procesadas · ${results.skipped} ya existian · ${results.errors} errores`)
    setStep('done');onImported(results.rows)
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

// ─── APP ROOT ─────────────────────────────────────────────────────────────────
export default function App() {
  const [session,setSession]=useState(null)
  const [loadingAuth,setLoadingAuth]=useState(true)
  const [user,setUser]=useState(null)
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

  useEffect(()=>{
    getSession().then(({data:{session}})=>{
      setSession(session)
      if(session)setUser(getUserInfo(session.user.email))
      setLoadingAuth(false)
    })
    const {data:{subscription}}=onAuthChange((_,session)=>{
      setSession(session)
      if(session){setUser(getUserInfo(session.user.email));if(session.provider_token)saveDriveToken(session.provider_token)}
      else setUser(null)
    })
    return ()=>subscription.unsubscribe()
  },[])

  useEffect(()=>{
    if(!session) return
    setLoading(true)
    Promise.all([
      getClients(),
      supabase.from('sales').select('*').order('created_at',{ascending:false}).then(({data})=>data||[]),
      getBilling(),
      supabase.from('expenses').select('*').order('date',{ascending:false}).then(({data})=>data||[]),
      supabase.from('tasks').select('*').order('due',{ascending:true,nullsFirst:false}).then(({data})=>data||[]),
    ]).then(([c,s,b,e,t])=>{setClients(c);setSales(s);setBilling(b);setExpenses(e);setTasks(t)})
      .catch(console.error).finally(()=>setLoading(false))
  },[session])

  const handleSaveSale=useCallback(async(f)=>{
    setSaving(true)
    try{
      const p={...f,amount_uf:parseFloat(f.amount_uf)||null,uf_value:parseFloat(f.uf_value)||null,updated_at:new Date().toISOString()}
      const{data,error}=await supabase.from('sales').upsert(p).select().single()
      if(error)throw error
      setSales(p=>f.id?p.map(x=>x.id===data.id?data:x):[data,...p])
      setModal(null)
    }catch(e){alert('Error: '+e.message)}
    setSaving(false)
  },[])

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
      const{data,error}=await supabase.from('tasks').upsert(f).select().single()
      if(error)throw error
      setTasks(p=>f.id?p.map(x=>x.id===data.id?data:x):[data,...p])
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
      const payload={...f,amount:parseInt(f.amount)||0,updated_at:new Date().toISOString()}
      const saved=await upsertBilling(payload)
      setBilling(p=>{const wc={...saved,clients:clients.find(c=>c.id===saved.client_id),erasmo:f.erasmo};return f.id?p.map(x=>x.id===saved.id?wc:x):[wc,...p]})
      setModal(null)
    }catch(e){alert('Error: '+e.message)}
    setSaving(false)
  },[clients])

  const handleStatusChange=useCallback(async(id,status)=>{
    await updateBillingStatus(id,status)
    setBilling(p=>p.map(x=>x.id===id?{...x,status}:x))
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
          .bottomnav{max-width:600px;left:50%!important;right:auto!important;transform:translateX(-50%);border-left:1px solid ${C.border};border-right:1px solid ${C.border}}
          .fab{right:auto!important;left:50%!important;margin-left:228px}
        }
      `}</style>
      <div className='shell' style={{background:C.bg,minHeight:'100vh',position:'relative'}}>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'52px 20px 4px',position:'sticky',top:0,background:C.bg,zIndex:20}}>
          <button onClick={signOut} style={{background:'none',border:'none',color:C.muted,fontSize:11,cursor:'pointer',fontWeight:500}}>{user?.name} · Salir</button>
          <button onClick={()=>setHideErasmo(h=>!h)} style={{padding:'5px 12px',borderRadius:20,border:`1px solid ${hideErasmo?C.accent:C.border}`,background:hideErasmo?'#E6EEF1':'transparent',color:hideErasmo?C.accent:C.muted,fontSize:11,fontWeight:600,cursor:'pointer'}}>
            {hideErasmo?'Solo Cristobal':'Todo el estudio'}
          </button>
        </div>
        {loading?(
          <div style={{display:'flex',alignItems:'center',justifyContent:'center',height:'60vh'}}><Spin/></div>
        ):(
          <div style={{paddingBottom:80,overflowY:'auto'}}>
            {tab==='dashboard'&&<Dashboard sales={sales} billing={billing} clients={clients} expenses={expenses} tasks={tasks} hideErasmo={hideErasmo} setTab={setTab} user={user}/>}
            {tab==='sales'&&<SalesView sales={sales} clients={clients} hideErasmo={hideErasmo} onEdit={s=>setModal({type:'sale',data:s})} onAdd={()=>setModal({type:'sale',data:null})}/>}
            {tab==='billing'&&<BillingView billing={billing} clients={clients} hideErasmo={hideErasmo} onStatusChange={handleStatusChange} onAdd={()=>setModal({type:'billing',data:null})} onEdit={b=>setModal({type:'billing',data:b})} onImport={()=>setModal({type:'drive',data:null})}/>}
            {tab==='expenses'&&<ExpensesView expenses={expenses} clients={clients} sales={sales} onAdd={()=>setModal({type:'expense',data:null})} onEdit={e=>setModal({type:'expense',data:e})}/>}
            {tab==='clients'&&<ClientsView clients={clients} sales={sales} billing={billing} expenses={expenses} onEdit={c=>setModal({type:'client',data:c})} onAdd={()=>setModal({type:'client',data:null})} onAddTask={()=>setModal({type:'task',data:null})}/>}
          </div>
        )}
        <BottomNav tab={tab} setTab={setTab} overdueN={overdueN}/>
        <button className='fab' onClick={()=>{
          const map={sales:'sale',billing:'billing',expenses:'expense',clients:'task'}
          setModal({type:map[tab]||'sale',data:null})
        }} style={{position:'fixed',bottom:24,right:20,width:52,height:52,borderRadius:'50%',background:C.accent,border:'none',cursor:'pointer',fontSize:24,color:'#fff',display:'flex',alignItems:'center',justifyContent:'center',boxShadow:'0 6px 20px rgba(0,60,80,.32)',zIndex:100}}>+</button>

        {modal?.type==='sale'&&<Modal title={modal.data?.id?'Editar venta':'Nueva venta'} onClose={()=>setModal(null)}><SaleForm sale={modal.data} clients={clients} onSave={handleSaveSale} onClose={()=>setModal(null)} onDelete={handleDeleteSale} saving={saving}/></Modal>}
        {modal?.type==='billing'&&<Modal title={modal.data?.id?'Editar cobro':'Nuevo cobro'} onClose={()=>setModal(null)}><BillingForm bill={modal.data} clients={clients} onSave={handleSaveBilling} onClose={()=>setModal(null)} saving={saving}/></Modal>}
        {modal?.type==='expense'&&<Modal title={modal.data?.id?'Editar registro':'Nuevo registro'} onClose={()=>setModal(null)}><ExpenseForm expense={modal.data} clients={clients} sales={sales} onSave={handleSaveExpense} onClose={()=>setModal(null)} onDelete={handleDeleteExpense} saving={saving}/></Modal>}
        {modal?.type==='drive'&&<Modal title='Importar facturas desde Drive' onClose={()=>setModal(null)}><DriveImporter clients={clients} billing={billing} onImported={()=>{}} onClose={()=>setModal(null)}/></Modal>}
        {modal?.type==='task'&&<Modal title='Nueva tarea' onClose={()=>setModal(null)}><QuickTaskForm clients={clients} sales={sales} onSave={handleSaveTask} onClose={()=>setModal(null)} saving={saving}/></Modal>}
        {modal?.type==='client'&&<Modal title={modal.data?.id?'Editar cliente':'Nuevo cliente'} onClose={()=>setModal(null)}><ClientForm client={modal.data} onSave={handleSaveClient} onClose={()=>setModal(null)} onDelete={handleDeleteClient} saving={saving} sales={sales}/></Modal>}
      </div>
    </>
  )
}
