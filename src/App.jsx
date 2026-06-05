import { useState, useEffect, useCallback, useMemo } from 'react'
import {
  supabase, signInWithGoogle, signOut, onAuthChange, getSession, getUserInfo,
  getClients, getMatters, getBilling,
  getClientEntities, upsertClientEntity, deleteClientEntity, getAllEntities,
  getDriveToken, connectDrive, getDriveTokenStored, saveDriveToken,
  upsertClient, deleteClient as dbDeleteClient,
  upsertMatter, deleteMatter as dbDeleteMatter,
  upsertBilling, updateBillingStatus
} from './supabase'

const FONT = "https://fonts.googleapis.com/css2?family=DM+Sans:opsz,wght@9..40,300;9..40,400;9..40,500;9..40,600;9..40,700&display=swap"

const C = {
  bg: '#F5F5F5', surface: '#FFFFFF', card: '#FFFFFF',
  border: '#E4E4E4', text: '#3D3D3D', muted: '#8A8A8A',
  accent: '#003C50', overdue: '#C2382B', urgent: '#C2382B',
  soon: '#C77F18', normal: '#2E7D55', done: '#A8A8A8',
}

const fmt = n => new Intl.NumberFormat('es-CL',{style:'currency',currency:'CLP',maximumFractionDigits:0}).format(n||0)
const fmtDate = d => { if(!d) return '—'; return new Date(d+'T12:00').toLocaleDateString('es-CL',{day:'2-digit',month:'short'}) }
const daysLeft = d => { if(!d) return null; return Math.round((new Date(d+'T12:00') - new Date()) / 86400000) }
const urgency = (due, status) => {
  if(['Completado','Pagado','Archivado','Anulado'].includes(status)) return 'done'
  const d = daysLeft(due)
  if(d===null) return 'normal'
  if(d<0) return 'overdue'
  if(d<=5) return 'urgent'
  if(d<=14) return 'soon'
  return 'normal'
}
const urgencyColor = (due, status) => ({ overdue:C.overdue, urgent:C.urgent, soon:C.soon, normal:C.normal, done:C.done })[urgency(due,status)] || C.muted

const Dot = ({due,status}) => <span style={{display:'inline-block',width:7,height:7,borderRadius:'50%',background:urgencyColor(due,status),flexShrink:0,marginTop:2}}/>
const DaysBadge = ({due,status}) => {
  const u = urgency(due,status)
  if(u==='done') return null
  const d = daysLeft(due)
  if(d===null) return null
  const label = d<0?`${Math.abs(d)}d vencido`:d===0?'hoy':`${d}d`
  return <span style={{fontSize:10,fontWeight:600,color:urgencyColor(due,status),whiteSpace:'nowrap'}}>{label}</span>
}
const AreaChip = ({area}) => {
  const bg = {Corporativo:'#E3EEF3',Tributario:'#F2E9DE',Sucesorio:'#ECE6F5',Patrimonial:'#E2F0EA',Laboral:'#F2E9DE',Litigación:'#F7E4E2',Inmobiliario:'#E4F1E8',Internacional:'#E3EFF3'}
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
        <button onClick={onClose} style={{background:'none',border:'none',color:C.muted,fontSize:24,cursor:'pointer',lineHeight:1}}>×</button>
      </div>
      <div style={{padding:'18px 20px'}}>{children}</div>
    </div>
  </div>
)

function LoginScreen({loading}) {
  return (
    <div style={{minHeight:'100vh',background:C.bg,display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',padding:32}}>
      <div style={{fontSize:11,color:C.muted,letterSpacing:2,textTransform:'uppercase',marginBottom:8}}>Bienvenido a</div>
      <div style={{fontSize:32,fontWeight:600,color:C.text,fontFamily:"'DM Sans',sans-serif",letterSpacing:-.4,marginBottom:4,textAlign:'center'}}>Liberona Escala</div>
      <div style={{fontSize:13,color:C.muted,marginBottom:48}}>Gestión del Estudio · leabogados.cl</div>
      <button onClick={signInWithGoogle} disabled={loading} style={{display:'flex',alignItems:'center',gap:12,padding:'14px 28px',borderRadius:12,border:`1px solid ${C.border}`,background:C.surface,color:C.text,fontSize:14,fontWeight:600,cursor:'pointer',width:'100%',maxWidth:300,justifyContent:'center'}}>
        {loading ? <Spin/> : <>
          <svg width="18" height="18" viewBox="0 0 24 24"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/></svg>
          Entrar con Google Workspace
        </>}
      </button>
      <div style={{fontSize:11,color:C.muted,marginTop:16,textAlign:'center'}}>Solo cuentas @leabogados.cl</div>
    </div>
  )
}

// ─── BOTTOM NAV (arreglado para desktop) ─────────────────────────────────────
const TABS = [
  {id:'dashboard', icon:'⬡', label:'Inicio'},
  {id:'matters',   icon:'⬜', label:'Asuntos'},
  {id:'tasks',     icon:'◇',  label:'Tareas'},
  {id:'billing',   icon:'$',  label:'Cobros'},
  {id:'clients',   icon:'⊙',  label:'Clientes'},
]
function BottomNav({tab,setTab,urgentN,overdueN}) {
  return (
    <div className='bottomnav' style={{position:'fixed',bottom:0,left:0,right:0,background:C.surface,borderTop:`1px solid ${C.border}`,display:'flex',zIndex:50,paddingBottom:'env(safe-area-inset-bottom,0)'}}>
      {TABS.map(t=>(
        <button key={t.id} onClick={()=>setTab(t.id)} style={{flex:1,padding:'10px 0 8px',background:'none',border:'none',cursor:'pointer',display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',gap:3,position:'relative',minWidth:0}}>
          <span style={{fontSize:16,lineHeight:1,color:tab===t.id?C.accent:C.muted}}>{t.icon}</span>
          <span style={{fontSize:10,color:tab===t.id?C.accent:C.muted,fontWeight:tab===t.id?700:400,whiteSpace:'nowrap'}}>{t.label}</span>
          {t.id==='tasks'&&urgentN>0&&<span style={{position:'absolute',top:4,right:'calc(50% - 16px)',background:C.overdue,color:'#fff',borderRadius:10,fontSize:9,fontWeight:700,padding:'1px 5px'}}>{urgentN}</span>}
          {t.id==='billing'&&overdueN>0&&<span style={{position:'absolute',top:4,right:'calc(50% - 16px)',background:C.overdue,color:'#fff',borderRadius:10,fontSize:9,fontWeight:700,padding:'1px 5px'}}>{overdueN}</span>}
        </button>
      ))}
    </div>
  )
}

function Dashboard({matters,billing,clients,hideErasmo,setTab,user}) {
  const mm = hideErasmo ? matters.filter(m=>!m.clients?.erasmo) : matters
  const bb = hideErasmo ? billing.filter(b=>!b.erasmo) : billing
  const activeCount = mm.filter(m=>m.status==='Activo').length
  const overdueCount = mm.filter(m=>urgency(m.due,m.status)==='overdue').length
  const urgentCount = mm.filter(m=>urgency(m.due,m.status)==='urgent').length
  const pendingAmt = bb.filter(b=>b.status==='Pendiente').reduce((s,b)=>s+(b.amount||0),0)
  const overdueAmt = bb.filter(b=>b.status==='Vencido').reduce((s,b)=>s+(b.amount||0),0)
  const critical = mm.filter(m=>['overdue','urgent'].includes(urgency(m.due,m.status))).sort((a,b)=>(daysLeft(a.due)||99)-(daysLeft(b.due)||99)).slice(0,7)
  const pendingBills = bb.filter(b=>['Pendiente','Vencido'].includes(b.status)).sort((a,b)=>(daysLeft(a.due)||99)-(daysLeft(b.due)||99)).slice(0,5)

  return (
    <div>
      <div style={{padding:'20px 20px 0'}}>
        <div style={{fontSize:11,color:C.muted,fontWeight:500,letterSpacing:.5,marginBottom:2}}>{new Date().toLocaleDateString('es-CL',{weekday:'long',day:'numeric',month:'long'}).replace(/^\w/,c=>c.toUpperCase())}</div>
        <div style={{fontSize:26,fontWeight:600,color:C.text,fontFamily:"'DM Sans',sans-serif",letterSpacing:-.4,lineHeight:1.1,marginBottom:2}}>Buenas, {user?.name?.split(' ')[0]}</div>
        <div style={{fontSize:12,color:C.muted}}>Liberona Escala Abogados</div>
      </div>
      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10,padding:'16px 20px 0'}}>
        <div style={{background:C.card,borderRadius:12,padding:'14px 16px',border:`1px solid ${C.border}`}}>
          <div style={{fontSize:11,color:C.muted,fontWeight:500,marginBottom:6,textTransform:'uppercase',letterSpacing:.5}}>Asuntos activos</div>
          <div style={{fontSize:24,fontWeight:600,color:overdueCount>0?C.overdue:urgentCount>0?C.soon:C.normal,lineHeight:1}}>{activeCount}</div>
          <div style={{fontSize:11,color:overdueCount>0?C.overdue:C.muted,marginTop:4}}>{overdueCount>0?`${overdueCount} vencidos`:urgentCount>0?`${urgentCount} urgentes`:'Al día ✓'}</div>
        </div>
        <div style={{background:C.card,borderRadius:12,padding:'14px 16px',border:`1px solid ${C.border}`}}>
          <div style={{fontSize:11,color:C.muted,fontWeight:500,marginBottom:6,textTransform:'uppercase',letterSpacing:.5}}>Por cobrar</div>
          <div style={{fontSize:18,fontWeight:600,color:overdueAmt>0?C.overdue:C.normal,lineHeight:1}}>{fmt(pendingAmt)}</div>
          <div style={{fontSize:11,color:overdueAmt>0?C.overdue:C.muted,marginTop:4}}>{overdueAmt>0?`${fmt(overdueAmt)} vencido`:'Sin vencidos'}</div>
        </div>
      </div>
      {critical.length>0&&(
        <div style={{padding:'20px 20px 0'}}>
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:10}}>
            <span style={{fontSize:11,fontWeight:600,color:C.muted,textTransform:'uppercase',letterSpacing:.5}}>Requieren atención</span>
            <button onClick={()=>setTab('matters')} style={{background:'none',border:'none',color:C.accent,fontSize:12,cursor:'pointer',fontWeight:600}}>Ver todos →</button>
          </div>
          {critical.map(m=>(
            <div key={m.id} style={{background:C.card,borderRadius:10,padding:'11px 13px',marginBottom:7,border:`1px solid ${C.border}`,display:'flex',gap:10,alignItems:'flex-start'}}>
              <Dot due={m.due} status={m.status}/>
              <div style={{flex:1,minWidth:0}}>
                <div style={{fontSize:13,fontWeight:500,color:C.text,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',marginBottom:2}}>{m.title}</div>
                <div style={{fontSize:11,color:C.muted,display:'flex',gap:8,alignItems:'center'}}>
                  <span style={{overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{m.clients?.name?.split('/')[0].trim()}</span>
                  <span>·</span><span>{m.who}</span>
                  <span>·</span><DaysBadge due={m.due} status={m.status}/>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
      {pendingBills.length>0&&(
        <div style={{padding:'16px 20px 6px'}}>
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:10}}>
            <span style={{fontSize:11,fontWeight:600,color:C.muted,textTransform:'uppercase',letterSpacing:.5}}>Cobros pendientes</span>
            <button onClick={()=>setTab('billing')} style={{background:'none',border:'none',color:C.accent,fontSize:12,cursor:'pointer',fontWeight:600}}>Ver todos →</button>
          </div>
          {pendingBills.map(b=>(
            <div key={b.id} style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'9px 0',borderBottom:`1px solid ${C.border}`}}>
              <div style={{minWidth:0,flex:1}}>
                <div style={{fontSize:13,fontWeight:500,color:C.text,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{b.clients?.name?.split('/')[0].trim()}</div>
                <div style={{fontSize:11,color:C.muted}}>{b.invoice_no} · {fmtDate(b.due)}</div>
              </div>
              <div style={{textAlign:'right',flexShrink:0,marginLeft:12}}>
                <div style={{fontSize:14,fontWeight:600,color:b.status==='Vencido'?C.overdue:C.text}}>{fmt(b.amount)}</div>
                <Pill label={b.status} bg={b.status==='Vencido'?C.overdue:b.status==='Pendiente'?C.accent:C.normal} small/>
              </div>
            </div>
          ))}
        </div>
      )}
      <div style={{height:20}}/>
    </div>
  )
}

function MattersView({matters,clients,hideErasmo,onEdit,onAdd}) {
  const [q,setQ] = useState('')
  const [fWho,setFWho] = useState('')
  const [fArea,setFArea] = useState('')
  const filtered = useMemo(()=>{
    let mm = hideErasmo ? matters.filter(m=>!m.clients?.erasmo) : matters
    if(q) mm=mm.filter(m=>m.title?.toLowerCase().includes(q.toLowerCase())||m.clients?.name?.toLowerCase().includes(q.toLowerCase()))
    if(fWho) mm=mm.filter(m=>m.who===fWho)
    if(fArea) mm=mm.filter(m=>m.area===fArea)
    return mm.sort((a,b)=>{const o={overdue:0,urgent:1,soon:2,normal:3,done:4};return (o[urgency(a.due,a.status)]||3)-(o[urgency(b.due,b.status)]||3)})
  },[matters,hideErasmo,q,fWho,fArea])
  const byClient = useMemo(()=>{
    const map={}
    filtered.forEach(m=>{if(!map[m.client_id])map[m.client_id]=[];map[m.client_id].push(m)})
    return map
  },[filtered])
  return (
    <div>
      <div style={{padding:'20px 20px 10px',position:'sticky',top:0,background:C.bg,zIndex:10}}>
        <div style={{fontSize:20,fontWeight:600,color:C.text,fontFamily:"'DM Sans',sans-serif",letterSpacing:-.4,marginBottom:12}}>Asuntos</div>
        <Inp value={q} onChange={e=>setQ(e.target.value)} placeholder='Buscar…' style={{marginBottom:8}}/>
        <div style={{display:'flex',gap:8}}>
          <select value={fWho} onChange={e=>setFWho(e.target.value)} style={{flex:1,padding:'7px 10px',borderRadius:8,border:`1px solid ${C.border}`,background:'#F7F7F7',color:C.text,fontSize:12}}>
            <option value=''>Todos</option>
            {['Cristóbal','Martín','Erasmo','Rodrigo','Martina'].map(w=><option key={w} value={w}>{w}</option>)}
          </select>
          <select value={fArea} onChange={e=>setFArea(e.target.value)} style={{flex:1,padding:'7px 10px',borderRadius:8,border:`1px solid ${C.border}`,background:'#F7F7F7',color:C.text,fontSize:12}}>
            <option value=''>Todas las áreas</option>
            {['Corporativo','Tributario','Laboral'].map(a=><option key={a} value={a}>{a}</option>)}
          </select>
        </div>
      </div>
      <div style={{padding:'4px 20px 100px'}}>
        {Object.keys(byClient).map(cid=>{
          const ms=byClient[cid]
          const client=ms[0]?.clients
          return (
            <div key={cid} style={{marginBottom:18}}>
              <div style={{fontSize:12,fontWeight:600,color:C.accent,letterSpacing:.3,marginBottom:7,display:'flex',gap:6,alignItems:'center'}}>
                {client?.name}
                {client?.erasmo&&<Pill label='Erasmo' bg='#EAF0F2' color={C.accent} small/>}
              </div>
              {ms.map(m=>(
                <div key={m.id} onClick={()=>onEdit(m)} style={{background:C.card,borderRadius:10,padding:'11px 13px',marginBottom:6,border:`1px solid ${C.border}`,display:'flex',gap:10,cursor:'pointer'}}
                  onMouseEnter={e=>e.currentTarget.style.borderColor=C.accent}
                  onMouseLeave={e=>e.currentTarget.style.borderColor=C.border}>
                  <Dot due={m.due} status={m.status}/>
                  <div style={{flex:1,minWidth:0}}>
                    <div style={{fontSize:13,fontWeight:500,color:C.text,marginBottom:3,lineHeight:1.3}}>{m.title}</div>
                    <div style={{display:'flex',gap:6,flexWrap:'wrap',alignItems:'center'}}>
                      <AreaChip area={m.area}/><span style={{fontSize:11,color:C.muted}}>{m.who}</span><DaysBadge due={m.due} status={m.status}/>
                    </div>
                    {m.note&&<div style={{fontSize:11,color:C.muted,marginTop:3,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{m.note}</div>}
                  </div>
                </div>
              ))}
            </div>
          )
        })}
        {Object.keys(byClient).length===0&&<div style={{color:C.muted,textAlign:'center',padding:40}}>Sin resultados</div>}
      </div>
    </div>
  )
}

function TasksView({matters,hideErasmo,onEdit}) {
  const [who,setWho] = useState('Cristóbal')
  const filtered = useMemo(()=>{
    let mm = hideErasmo ? matters.filter(m=>!m.clients?.erasmo) : matters
    return mm.filter(m=>m.who===who&&m.status==='Activo').sort((a,b)=>{const o={overdue:0,urgent:1,soon:2,normal:3};return (o[urgency(a.due,a.status)]||3)-(o[urgency(b.due,b.status)]||3)})
  },[matters,hideErasmo,who])
  return (
    <div>
      <div style={{padding:'20px 20px 10px',position:'sticky',top:0,background:C.bg,zIndex:10}}>
        <div style={{fontSize:20,fontWeight:600,color:C.text,fontFamily:"'DM Sans',sans-serif",letterSpacing:-.4,marginBottom:12}}>Tareas</div>
        <div style={{display:'flex',gap:6,flexWrap:'wrap'}}>
          {['Cristóbal','Martín','Erasmo','Rodrigo','Martina'].map(w=>(
            <button key={w} onClick={()=>setWho(w)} style={{padding:'6px 14px',borderRadius:20,border:`1px solid ${who===w?C.accent:C.border}`,background:who===w?'#E6EEF1':'transparent',color:who===w?C.accent:C.muted,fontSize:12,fontWeight:600,cursor:'pointer'}}>{w}</button>
          ))}
        </div>
      </div>
      <div style={{padding:'8px 20px 100px'}}>
        {filtered.length===0&&<div style={{color:C.muted,textAlign:'center',padding:40}}>Sin tareas activas para {who}</div>}
        {filtered.map(m=>(
          <div key={m.id} onClick={()=>onEdit(m)} style={{background:C.card,borderRadius:10,padding:'12px 14px',marginBottom:8,border:`1px solid ${C.border}`,display:'flex',gap:10,cursor:'pointer'}}
            onMouseEnter={e=>e.currentTarget.style.borderColor=C.accent}
            onMouseLeave={e=>e.currentTarget.style.borderColor=C.border}>
            <Dot due={m.due} status={m.status}/>
            <div style={{flex:1,minWidth:0}}>
              <div style={{fontSize:13,fontWeight:500,color:C.text,marginBottom:3}}>{m.title}</div>
              <div style={{fontSize:11,color:C.muted,display:'flex',gap:6,flexWrap:'wrap',alignItems:'center'}}>
                <span style={{overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{m.clients?.name?.split('/')[0].trim()}</span>
                <AreaChip area={m.area}/><DaysBadge due={m.due} status={m.status}/>
              </div>
              {m.note&&<div style={{fontSize:11,color:C.muted,marginTop:3,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{m.note}</div>}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── BILLING VIEW (con botón editar y nuevo cobro) ───────────────────────────
function BillingView({billing,clients,hideErasmo,onStatusChange,onAdd,onEdit,onImport}) {
  const [filter,setFilter] = useState('activo')
  const bb = hideErasmo ? billing.filter(b=>!b.erasmo) : billing
  const filtered = useMemo(()=>{
    if(filter==='activo') return bb.filter(b=>['Pendiente','Vencido','Propuesta'].includes(b.status))
    if(filter==='pagado') return bb.filter(b=>b.status==='Pagado')
    return bb
  },[bb,filter])
  const pending=bb.filter(b=>b.status==='Pendiente').reduce((s,b)=>s+(b.amount||0),0)
  const overdue=bb.filter(b=>b.status==='Vencido').reduce((s,b)=>s+(b.amount||0),0)
  const paid=bb.filter(b=>b.status==='Pagado').reduce((s,b)=>s+(b.amount||0),0)
  return (
    <div>
      <div style={{padding:'20px 20px 0',position:'sticky',top:0,background:C.bg,zIndex:10}}>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:12}}>
          <div style={{fontSize:20,fontWeight:600,color:C.text,fontFamily:"'DM Sans',sans-serif",letterSpacing:-.4}}>Cobros</div>
          <div style={{display:'flex',gap:6}}>
            <button onClick={onImport} style={{padding:'6px 12px',borderRadius:8,border:`1px solid ${C.border}`,background:'#fff',color:C.accent,fontSize:12,fontWeight:600,cursor:'pointer'}}>↓ Drive</button>
            <button onClick={onAdd} style={{padding:'6px 12px',borderRadius:8,border:`1px solid ${C.accent}`,background:C.accent,color:'#fff',fontSize:12,fontWeight:600,cursor:'pointer'}}>+ Nuevo</button>
          </div>
        </div>
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:8,marginBottom:12}}>
          {[['Por cobrar',fmt(pending),'#E3EEF3',C.accent],['Vencido',fmt(overdue),'#FBE9E7',C.overdue],['Cobrado',fmt(paid),'#E4F1EA',C.normal]].map(([l,v,bg,col])=>(
            <div key={l} style={{background:bg,borderRadius:10,padding:'10px 12px',border:`1px solid ${C.border}`}}>
              <div style={{fontSize:10,color:C.muted,marginBottom:3,textTransform:'uppercase',letterSpacing:.4}}>{l}</div>
              <div style={{fontSize:13,fontWeight:700,color:col}}>{v}</div>
            </div>
          ))}
        </div>
        <div style={{display:'flex',gap:6,marginBottom:4}}>
          {[['activo','Pendientes'],['pagado','Pagados'],['all','Todos']].map(([v,l])=>(
            <button key={v} onClick={()=>setFilter(v)} style={{flex:1,padding:'7px 0',borderRadius:8,border:`1px solid ${filter===v?C.accent:C.border}`,background:filter===v?'#E6EEF1':'transparent',color:filter===v?C.accent:C.muted,fontSize:12,fontWeight:600,cursor:'pointer'}}>{l}</button>
          ))}
        </div>
      </div>
      <div style={{padding:'10px 20px 100px'}}>
        {filtered.length===0&&<div style={{color:C.muted,textAlign:'center',padding:40,fontSize:13}}>Sin cobros en esta categoría</div>}
        {filtered.map(b=>(
          <div key={b.id} style={{background:C.card,borderRadius:10,padding:'12px 14px',marginBottom:8,border:`1px solid ${C.border}`}}>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:6}}>
              <div style={{minWidth:0,flex:1}}>
                <div style={{fontSize:13,fontWeight:600,color:C.text,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{b.clients?.name?.split('/')[0].trim()}</div>
                <div style={{fontSize:11,color:C.muted,marginTop:1}}>{b.concept}</div>
              </div>
              <div style={{display:'flex',alignItems:'center',gap:8,flexShrink:0,marginLeft:12}}>
                <div style={{fontSize:15,fontWeight:600,color:b.status==='Vencido'?C.overdue:C.text}}>{fmt(b.amount)}</div>
                <button onClick={()=>onEdit(b)} style={{background:'none',border:`1px solid ${C.border}`,borderRadius:6,padding:'3px 8px',fontSize:11,color:C.muted,cursor:'pointer'}}>✎</button>
              </div>
            </div>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
              <div style={{display:'flex',gap:6,alignItems:'center'}}>
                <span style={{fontSize:11,color:C.muted,fontFamily:'monospace'}}>{b.invoice_no||'—'}</span>
                <span style={{fontSize:11,color:C.muted}}>· {fmtDate(b.due)}</span>
                <DaysBadge due={b.due} status={b.status}/>
              </div>
              <select value={b.status} onChange={e=>onStatusChange(b.id,e.target.value)}
                style={{padding:'3px 8px',borderRadius:6,border:`1px solid ${C.border}`,background:'#F7F7F7',color:C.accent,fontSize:11,fontWeight:600,cursor:'pointer'}}>
                {['Propuesta','Pendiente','Pagado','Vencido','Anulado'].map(s=><option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            {b.payment_method&&<div style={{fontSize:11,color:C.muted,marginTop:4}}>Pago: {b.payment_method}{b.payment_ref?` · ${b.payment_ref}`:''}{b.payment_date?` · ${fmtDate(b.payment_date)}`:''}</div>}
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── BILLING FORM ─────────────────────────────────────────────────────────────
function BillingForm({bill,clients,onSave,onClose,saving}) {
  const [f,setF] = useState(bill||{client_id:'',concept:'',amount:'',status:'Pendiente',invoice_no:'',issued_at:'',due:'',payment_method:'',payment_date:'',payment_ref:'',notes:'',erasmo:false})
  const up=(k,v)=>setF(p=>({...p,[k]:v}))
  return (
    <>
      <Fld label='Cliente'>
        <select value={f.client_id||''} onChange={e=>up('client_id',e.target.value)} style={{width:'100%',padding:'10px 12px',borderRadius:8,border:`1px solid ${C.border}`,background:'#F7F7F7',color:C.text,fontSize:14,boxSizing:'border-box'}}>
          <option value=''>— Seleccionar —</option>
          {clients.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </Fld>
      <Fld label='Concepto'><Inp value={f.concept||''} onChange={e=>up('concept',e.target.value)} placeholder='Descripción del cobro…'/></Fld>
      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10}}>
        <Fld label='Monto (CLP)'><Inp type='number' value={f.amount||''} onChange={e=>up('amount',e.target.value)} placeholder='0'/></Fld>
        <Fld label='Estado'><Sel value={f.status||'Pendiente'} onChange={e=>up('status',e.target.value)} options={['Propuesta','Pendiente','Pagado','Vencido','Anulado']}/></Fld>
        <Fld label='N° Factura'><Inp value={f.invoice_no||''} onChange={e=>up('invoice_no',e.target.value)} placeholder='F-001…'/></Fld>
        <Fld label='Vencimiento'><Inp type='date' value={f.due||''} onChange={e=>up('due',e.target.value)}/></Fld>
        <Fld label='Emisión'><Inp type='date' value={f.issued_at||''} onChange={e=>up('issued_at',e.target.value)}/></Fld>
        <Fld label='Forma de pago'><Sel value={f.payment_method||''} onChange={e=>up('payment_method',e.target.value)} options={['Transferencia','Cheque','Efectivo','Otro']} placeholder='— Opcional —'/></Fld>
      </div>
      {f.payment_method&&(
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10}}>
          <Fld label='Ref. pago'><Inp value={f.payment_ref||''} onChange={e=>up('payment_ref',e.target.value)} placeholder='N° transferencia…'/></Fld>
          <Fld label='Fecha pago'><Inp type='date' value={f.payment_date||''} onChange={e=>up('payment_date',e.target.value)}/></Fld>
        </div>
      )}
      <Fld label='Notas'><Txt value={f.notes||''} onChange={e=>up('notes',e.target.value)} placeholder='Observaciones…'/></Fld>
      <Fld label='Cartera'>
        <button type='button' onClick={()=>up('erasmo',!f.erasmo)} style={{padding:'9px 14px',borderRadius:8,border:`1px solid ${f.erasmo?C.accent:C.border}`,background:f.erasmo?'#E6EEF1':'transparent',color:f.erasmo?C.accent:C.muted,fontSize:13,fontWeight:600,cursor:'pointer'}}>
          {f.erasmo?'✓ Cobro de Erasmo':'Marcar como Erasmo'}
        </button>
      </Fld>
      <div style={{display:'flex',gap:8,marginTop:4}}>
        <button onClick={onClose} style={{flex:1,padding:11,borderRadius:10,border:`1px solid ${C.border}`,background:'transparent',color:C.muted,fontSize:13,fontWeight:600,cursor:'pointer'}}>Cancelar</button>
        <button disabled={saving||!f.client_id||!f.concept} onClick={()=>onSave(f)} style={{flex:2,padding:11,borderRadius:10,border:'none',background:C.accent,color:'#fff',fontSize:13,fontWeight:700,cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center',gap:8,opacity:(!f.client_id||!f.concept)?.6:1}}>
          {saving?<Spin/>:null}{saving?'Guardando…':'Guardar'}
        </button>
      </div>
    </>
  )
}

function EntitiesEditor({clientId}) {
  const [list,setList]         = useState(null)
  const [allEntities,setAll]   = useState([])
  const [name,setName]         = useState('')
  const [rut,setRut]           = useState('')
  const [suggestions,setSugg]  = useState([])
  const [showSugg,setShowSugg] = useState(false)
  const [edit,setEdit]         = useState(null)
  const [busy,setBusy]         = useState(false)
  const sortByName = arr => [...arr].sort((a,b)=>(a.name||'').localeCompare(b.name||'','es'))

  useEffect(()=>{
    let ok=true
    getClientEntities(clientId).then(d=>ok&&setList(d)).catch(()=>ok&&setList([]))
    getAllEntities().then(d=>ok&&setAll(d)).catch(()=>{})
    return ()=>{ok=false}
  },[clientId])

  const handleNameChange = (val) => {
    setName(val)
    if(val.trim().length < 2) { setSugg([]); setShowSugg(false); return }
    const q = val.toLowerCase()
    const matches = allEntities.filter(e=>e.name.toLowerCase().includes(q)).slice(0,6)
    setSugg(matches)
    setShowSugg(matches.length > 0)
  }

  const selectSugg = (e) => {
    setName(e.name)
    setRut(e.rut||'')
    setSugg([])
    setShowSugg(false)
  }

  const add = async()=>{
    if(!name.trim()) return
    setBusy(true)
    try {
      const saved = await upsertClientEntity({client_id:clientId,name:name.trim(),rut:rut.trim()||null})
      setList(p=>sortByName([...(p||[]),saved]))
      setName(''); setRut(''); setSugg([]); setShowSugg(false)
      setAll(p=>{
        const exists = p.some(x=>x.name.toLowerCase()===saved.name.toLowerCase())
        return exists ? p : sortByName([...p,saved])
      })
    } catch(e){ alert('Error al agregar: '+e.message) }
    setBusy(false)
  }
  const saveEdit = async()=>{
    if(!edit.name.trim()) return
    setBusy(true)
    try {
      const saved = await upsertClientEntity({id:edit.id,client_id:clientId,name:edit.name.trim(),rut:edit.rut?.trim()||null})
      setList(p=>sortByName(p.map(x=>x.id===saved.id?saved:x))); setEdit(null)
    } catch(e){ alert('Error al guardar: '+e.message) }
    setBusy(false)
  }
  const del = async(id)=>{
    if(!confirm('¿Eliminar esta razón social?')) return
    try { await deleteClientEntity(id); setList(p=>p.filter(x=>x.id!==id)) }
    catch(e){ alert('Error al eliminar: '+e.message) }
  }

  const inS = {padding:'8px 10px',borderRadius:7,border:`1px solid ${C.border}`,background:'#fff',color:C.text,fontSize:13,boxSizing:'border-box',outline:'none'}
  const iconBtn = (color)=>({width:30,height:30,flexShrink:0,borderRadius:7,border:`1px solid ${C.border}`,background:'#fff',color,fontSize:14,cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center'})

  return (
    <div style={{marginBottom:14,padding:14,borderRadius:10,border:`1px solid ${C.border}`,background:'#FAFAFA'}}>
      <Lbl>Entidades facturables</Lbl>
      {list===null&&<div style={{fontSize:12,color:C.muted,padding:'4px 0'}}>Cargando…</div>}
      {list!==null&&list.length===0&&<div style={{fontSize:12,color:C.muted,padding:'2px 0 8px'}}>Sin razones sociales aún.</div>}
      {list?.map(e=>(
        <div key={e.id} style={{display:'flex',gap:6,alignItems:'center',marginBottom:6}}>
          {edit?.id===e.id ? (
            <>
              <input value={edit.name} onChange={ev=>setEdit({...edit,name:ev.target.value})} placeholder='Razón social' style={{...inS,flex:1,minWidth:0}}/>
              <input value={edit.rut||''} onChange={ev=>setEdit({...edit,rut:ev.target.value})} placeholder='RUT' style={{...inS,width:110,flexShrink:0}}/>
              <button onClick={saveEdit} disabled={busy} style={iconBtn(C.normal)} title='Guardar'>✓</button>
              <button onClick={()=>setEdit(null)} style={iconBtn(C.muted)} title='Cancelar'>×</button>
            </>
          ) : (
            <>
              <div style={{flex:1,minWidth:0}}>
                <div style={{fontSize:13,color:C.text,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{e.name}</div>
                {e.rut&&<div style={{fontSize:11,color:C.muted}}>{e.rut}</div>}
              </div>
              <button onClick={()=>setEdit({id:e.id,name:e.name,rut:e.rut})} style={iconBtn(C.accent)} title='Editar'>✎</button>
              <button onClick={()=>del(e.id)} style={iconBtn(C.overdue)} title='Eliminar'>×</button>
            </>
          )}
        </div>
      ))}
      <div style={{marginTop:8,position:'relative'}}>
        <div style={{display:'flex',gap:6}}>
          <div style={{flex:1,minWidth:0,position:'relative'}}>
            <input
              value={name}
              onChange={e=>handleNameChange(e.target.value)}
              onBlur={()=>setTimeout(()=>setShowSugg(false),150)}
              placeholder='Razón social (escribe para buscar o nueva)'
              style={{...inS,width:'100%'}}
            />
            {showSugg&&suggestions.length>0&&(
              <div style={{position:'absolute',top:'100%',left:0,right:0,background:'#fff',border:`1px solid ${C.border}`,borderRadius:7,boxShadow:'0 4px 16px rgba(0,0,0,.10)',zIndex:100,maxHeight:200,overflowY:'auto',marginTop:2}}>
                {suggestions.map((s,i)=>(
                  <div key={i} onMouseDown={()=>selectSugg(s)} style={{padding:'8px 12px',cursor:'pointer',borderBottom:`1px solid ${C.border}`,fontSize:13}}
                    onMouseEnter={e=>e.currentTarget.style.background='#F0F4F6'}
                    onMouseLeave={e=>e.currentTarget.style.background='#fff'}>
                    <div style={{fontWeight:500,color:C.text}}>{s.name}</div>
                    {s.rut&&<div style={{fontSize:11,color:C.muted}}>{s.rut}</div>}
                  </div>
                ))}
                <div style={{padding:'6px 12px',fontSize:11,color:C.muted,fontStyle:'italic',borderTop:`1px solid ${C.border}`}}>
                  O continúa escribiendo para agregar nueva
                </div>
              </div>
            )}
          </div>
          <input value={rut} onChange={e=>setRut(e.target.value)} placeholder='RUT' style={{...inS,width:110,flexShrink:0}}/>
          <button onClick={add} disabled={busy||!name.trim()} style={{padding:'0 12px',borderRadius:7,border:'none',background:C.accent,color:'#fff',fontSize:13,fontWeight:600,cursor:name.trim()?'pointer':'not-allowed',opacity:name.trim()?1:.6,flexShrink:0,whiteSpace:'nowrap'}}>Agregar</button>
        </div>
      </div>
    </div>
  )
}

function ClientForm({client,onSave,onClose,onDelete,saving}) {
  const [f,setF] = useState(client||{name:'',type:'',email:'',phone:'',contact:'',erasmo:false,status:'Activo',ended_at:'',notes:''})
  const up=(k,v)=>setF(p=>({...p,[k]:v}))
  const valid=f.name?.trim()
  return (
    <>
      <Fld label='Nombre'><Inp value={f.name||''} onChange={e=>up('name',e.target.value)} placeholder='Nombre del cliente…'/></Fld>
      <Fld label='Tipo / Área'><Sel value={f.type||''} onChange={e=>up('type',e.target.value)} options={['Corporativo','Tributario','Laboral']} placeholder='— Seleccionar —'/></Fld>
      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10}}>
        <Fld label='Email'><Inp type='email' value={f.email||''} onChange={e=>up('email',e.target.value)} placeholder='correo@…'/></Fld>
        <Fld label='Teléfono'><Inp value={f.phone||''} onChange={e=>up('phone',e.target.value)} placeholder='+56…'/></Fld>
      </div>
      <Fld label='Contacto'><Inp value={f.contact||''} onChange={e=>up('contact',e.target.value)} placeholder='Persona de contacto…'/></Fld>
      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10}}>
        <Fld label='Estado'><Sel value={f.status||'Activo'} onChange={e=>up('status',e.target.value)} options={['Activo','Terminado']}/></Fld>
        {f.status==='Terminado'&&<Fld label='Fecha de término'><Inp type='date' value={f.ended_at||''} onChange={e=>up('ended_at',e.target.value)}/></Fld>}
      </div>
      <Fld label='Cartera'>
        <button type='button' onClick={()=>up('erasmo',!f.erasmo)} style={{padding:'9px 14px',borderRadius:8,border:`1px solid ${f.erasmo?C.accent:C.border}`,background:f.erasmo?'#E6EEF1':'transparent',color:f.erasmo?C.accent:C.muted,fontSize:13,fontWeight:600,cursor:'pointer'}}>
          {f.erasmo?'✓ Cliente de Erasmo':'Marcar como Erasmo'}
        </button>
      </Fld>
      <Fld label='Notas'><Txt value={f.notes||''} onChange={e=>up('notes',e.target.value)} placeholder='Contexto relevante…'/></Fld>
      {client?.id
        ? <EntitiesEditor clientId={client.id}/>
        : <div style={{fontSize:11,color:C.muted,marginTop:-4,marginBottom:14}}>Guarda el cliente para agregar sus entidades facturables.</div>}
      <div style={{display:'flex',gap:8,marginTop:4}}>
        {client?.id&&<button onClick={()=>onDelete(client.id)} style={{padding:'11px 14px',borderRadius:10,border:`1px solid ${C.overdue}`,background:'transparent',color:C.overdue,fontSize:13,fontWeight:600,cursor:'pointer'}}>Eliminar</button>}
        <button onClick={onClose} style={{flex:1,padding:11,borderRadius:10,border:`1px solid ${C.border}`,background:'transparent',color:C.muted,fontSize:13,fontWeight:600,cursor:'pointer'}}>Cancelar</button>
        <button disabled={saving||!valid} onClick={()=>onSave(f)} style={{flex:2,padding:11,borderRadius:10,border:'none',background:C.accent,color:'#fff',fontSize:13,fontWeight:700,cursor:valid?'pointer':'not-allowed',opacity:valid?1:.6,display:'flex',alignItems:'center',justifyContent:'center',gap:8}}>
          {saving?<Spin/>:null}{saving?'Guardando…':'Guardar'}
        </button>
      </div>
    </>
  )
}

function ClientsView({clients,matters,billing,hideErasmo,onEdit,onAdd}) {
  const [sFilter,setSFilter] = useState('Activo')
  const base = hideErasmo ? clients.filter(c=>!c.erasmo) : clients
  const activeN = base.filter(c=>(c.status||'Activo')==='Activo').length
  const endedN  = base.filter(c=>c.status==='Terminado').length
  const cl = useMemo(()=>{
    if(sFilter==='Activo')    return base.filter(c=>(c.status||'Activo')==='Activo')
    if(sFilter==='Terminado') return base.filter(c=>c.status==='Terminado')
    return base
  },[base,sFilter])
  return (
    <div>
      <div style={{padding:'20px 20px 0',position:'sticky',top:0,background:C.bg,zIndex:10}}>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
          <div style={{fontSize:20,fontWeight:600,color:C.text,fontFamily:"'DM Sans',sans-serif",letterSpacing:-.4}}>Clientes</div>
          <div style={{display:'flex',gap:6}}>
            <button onClick={onImport} style={{padding:'6px 12px',borderRadius:8,border:`1px solid ${C.border}`,background:'#fff',color:C.accent,fontSize:12,fontWeight:600,cursor:'pointer'}}>↓ Drive</button>
            <button onClick={onAdd} style={{padding:'6px 12px',borderRadius:8,border:`1px solid ${C.accent}`,background:C.accent,color:'#fff',fontSize:12,fontWeight:600,cursor:'pointer'}}>+ Nuevo</button>
          </div>
        </div>
        <div style={{fontSize:12,color:C.muted,margin:'4px 0 12px'}}>{cl.length} {cl.length===1?'cliente':'clientes'}</div>
        <div style={{display:'flex',gap:6,marginBottom:4}}>
          {[['Activo',`Activos (${activeN})`],['Terminado',`Terminados (${endedN})`],['all','Todos']].map(([v,l])=>(
            <button key={v} onClick={()=>setSFilter(v)} style={{flex:1,padding:'7px 0',borderRadius:8,border:`1px solid ${sFilter===v?C.accent:C.border}`,background:sFilter===v?'#E6EEF1':'transparent',color:sFilter===v?C.accent:C.muted,fontSize:12,fontWeight:600,cursor:'pointer'}}>{l}</button>
          ))}
        </div>
      </div>
      <div style={{padding:'10px 20px 100px'}}>
        {cl.length===0&&<div style={{color:C.muted,textAlign:'center',padding:40}}>Sin clientes {sFilter==='Terminado'?'terminados':sFilter==='Activo'?'activos':''}</div>}
        {cl.map(c=>{
          const ended=c.status==='Terminado'
          const cm=matters.filter(m=>m.client_id===c.id&&m.status==='Activo').length
          const cp=billing.filter(b=>b.client_id===c.id&&['Pendiente','Vencido'].includes(b.status)).reduce((s,b)=>s+(b.amount||0),0)
          const hasOverdue=billing.some(b=>b.client_id===c.id&&b.status==='Vencido')
          return (
            <div key={c.id} onClick={()=>onEdit(c)} style={{background:C.card,borderRadius:10,padding:'13px 16px',marginBottom:8,border:`1px solid ${C.border}`,borderLeft:`3px solid ${ended?C.done:hasOverdue?C.overdue:C.accent}`,opacity:ended?.7:1,cursor:'pointer'}}
              onMouseEnter={e=>e.currentTarget.style.boxShadow='0 2px 12px rgba(0,0,0,.09)'}
              onMouseLeave={e=>e.currentTarget.style.boxShadow='none'}>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',gap:8}}>
                <div style={{minWidth:0}}>
                  <div style={{fontSize:14,fontWeight:600,color:C.text,marginBottom:2}}>{c.name}</div>
                  <div style={{fontSize:11,color:C.muted,marginBottom:6}}>{c.type}</div>
                </div>
                {ended&&<Pill label='Terminado' bg='#ECECEC' color={C.muted} small/>}
              </div>
              <div style={{display:'flex',gap:12,fontSize:11,alignItems:'center'}}>
                {ended
                  ? <span style={{color:C.muted}}>Terminó {fmtDate(c.ended_at)}</span>
                  : <span style={{color:C.accent}}>{cm} activos</span>}
                {cp>0&&<span style={{color:hasOverdue?C.overdue:C.soon,fontWeight:600}}>{fmt(cp)} pendiente</span>}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function MatterForm({matter,clients,onSave,onClose,onDelete,saving}) {
  const [f,setF] = useState(matter||{client_id:'',title:'',area:'Corporativo',status:'Activo',who:'Cristóbal',priority:'Alta',due:'',note:''})
  const up=(k,v)=>setF(p=>({...p,[k]:v}))
  return (
    <>
      <Fld label='Cliente'>
        <select value={f.client_id} onChange={e=>up('client_id',e.target.value)} style={{width:'100%',padding:'10px 12px',borderRadius:8,border:`1px solid ${C.border}`,background:'#F7F7F7',color:C.text,fontSize:14}}>
          <option value=''>— Seleccionar —</option>
          {clients.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </Fld>
      <Fld label='Asunto'><Inp value={f.title} onChange={e=>up('title',e.target.value)} placeholder='Descripción del asunto…'/></Fld>
      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10}}>
        <Fld label='Área'><Sel value={f.area} onChange={e=>up('area',e.target.value)} options={['Corporativo','Tributario','Laboral']}/></Fld>
        <Fld label='Responsable'><Sel value={f.who} onChange={e=>up('who',e.target.value)} options={['Cristóbal','Martín','Erasmo','Rodrigo','Martina']}/></Fld>
        <Fld label='Estado'><Sel value={f.status} onChange={e=>up('status',e.target.value)} options={['Activo','En Revisión','Suspendido','Completado']}/></Fld>
        <Fld label='Prioridad'><Sel value={f.priority} onChange={e=>up('priority',e.target.value)} options={['Alta','Media','Baja']}/></Fld>
      </div>
      <Fld label='Plazo'><Inp type='date' value={f.due||''} onChange={e=>up('due',e.target.value)}/></Fld>
      <Fld label='Notas'><Txt value={f.note||''} onChange={e=>up('note',e.target.value)} placeholder='Contexto relevante…'/></Fld>
      <div style={{display:'flex',gap:8,marginTop:4}}>
        {matter?.id&&<button onClick={()=>onDelete(matter.id)} style={{padding:'11px 14px',borderRadius:10,border:`1px solid ${C.overdue}`,background:'transparent',color:C.overdue,fontSize:13,fontWeight:600,cursor:'pointer'}}>Eliminar</button>}
        <button onClick={onClose} style={{flex:1,padding:11,borderRadius:10,border:`1px solid ${C.border}`,background:'transparent',color:C.muted,fontSize:13,fontWeight:600,cursor:'pointer'}}>Cancelar</button>
        <button disabled={saving} onClick={()=>onSave(f)} style={{flex:2,padding:11,borderRadius:10,border:'none',background:C.accent,color:'#fff',fontSize:13,fontWeight:700,cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center',gap:8}}>
          {saving?<Spin/>:null}{saving?'Guardando…':'Guardar'}
        </button>
      </div>
    </>
  )
}


// ── PARSER (mismo que parse-invoice.mjs) ─────────────────────────────────────
const MESES = {enero:1,febrero:2,marzo:3,abril:4,mayo:5,junio:6,julio:7,agosto:8,septiembre:9,setiembre:9,octubre:10,noviembre:11,diciembre:12}
function parseInvoice(raw) {
  const t = raw.replace(/[\\]/g,'').replace(/[ ]+/g,' ')
  const folio = (t.match(/N[°o°]\s*(\d+)/) || [])[1] || null
  let issued_at = null
  const fm = t.match(/Fecha Emision:\s*(\d{1,2})\s*de\s*([A-Za-záéíóúÁÉÍÓÚaeiou]+)\s*del?\s*(\d{4})/i)
  if(fm){ const dia=+fm[1],mes=MESES[fm[2].toLowerCase()],anio=+fm[3]; if(mes) issued_at=`${anio}-${String(mes).padStart(2,'0')}-${String(dia).padStart(2,'0')}` }
  const cm = t.match(/SEÑOR\(ES\):\s*(.+?)\s*R\.U\.T\.:\s*([\d.]+-[\dkK])/)
  const cliente = cm ? cm[1].trim() : null
  const rut = cm ? cm[2].replace(/\s+/g,'') : null
  const tm = t.match(/TOTAL\s*\$\s*([\d.]+)/)
  const total = tm ? parseInt(tm[1].replace(/\./g,''),10) : null
  let concepto = null
  const gm = t.match(/Valor\s*([\s\S]*?)\s*Forma de Pago/)
  if(gm){ concepto = gm[1].replace(/\s+/g,' ').replace(/^[-\s]+/,'').replace(/\s*\d+\s*[\d.]+\s*$/,'').trim()||null }
  return { folio, cliente, rut, issued_at, total, concepto }
}

// ── DRIVE IMPORTER ────────────────────────────────────────────────────────────
const FACTURACION_ROOT = '1GtcDmnq2FpGQlaZRETyOU4Zwf5MfCi7V'

async function driveGet(token, url) {
  const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
  if(!r.ok) throw new Error(`Drive API error ${r.status}`)
  return r.json()
}

function DriveImporter({ clients, billing, onImported, onClose }) {
  const [step, setStep]       = useState('init')   // init | loading | selectMonth | importing | done | error | notoken
  const [token, setToken]     = useState(null)
  const [years, setYears]     = useState([])
  const [months, setMonths]   = useState([])
  const [selYear, setSelYear] = useState(null)
  const [selMonth, setSelMonth] = useState(null)
  const [log, setLog]         = useState([])
  const [progress, setProgress] = useState({done:0,total:0})
  const addLog = (msg) => setLog(p=>[...p,msg])

  useEffect(()=>{ init() },[])

  async function init() {
    setStep('loading')
    let t = await getDriveToken()
    if(!t) t = getDriveTokenStored()
    console.log('Drive token:', t ? 'OK ('+t.slice(0,20)+'...)' : 'NULL')
    if(!t) { setStep('notoken'); return }
    setToken(t)
    try {
      const res = await driveGet(t, `https://www.googleapis.com/drive/v3/files?q='${FACTURACION_ROOT}'+in+parents+and+mimeType='application/vnd.google-apps.folder'+and+trashed=false&orderBy=name&fields=files(id,name)`)
      setYears(res.files||[])
      setStep('selectMonth')
    } catch(e){ console.error('Drive error:', e); setStep('error') }
  }

  async function loadMonths(yearId) {
    setSelYear(yearId)
    const t = token
    const res = await driveGet(t, `https://www.googleapis.com/drive/v3/files?q='${yearId}'+in+parents+and+mimeType='application/vnd.google-apps.folder'+and+trashed=false&orderBy=name&fields=files(id,name)`)
    setMonths(res.files||[])
  }

  async function importMonth(monthId, monthName) {
    setSelMonth(monthId)
    setStep('importing')
    setLog([`Importando ${monthName}…`])
    const t = token
    const res = await driveGet(t, `https://www.googleapis.com/drive/v3/files?q='${monthId}'+in+parents+and+mimeType='application/pdf'+and+trashed=false&fields=files(id,name)`)
    const pdfs = res.files||[]
    setProgress({done:0,total:pdfs.length})
    addLog(`${pdfs.length} PDFs encontrados`)

    const results = { imported:0, skipped:0, errors:0, rows:[] }

    for(let i=0;i<pdfs.length;i++){
      const pdf = pdfs[i]
      try {
        // Descargar PDF como texto via exportLinks (Drive extrae texto)
        const textRes = await fetch(`https://www.googleapis.com/drive/v3/files/${pdf.id}/export?mimeType=text/plain`, { headers:{Authorization:`Bearer ${t}`} })
        const text = textRes.ok ? await textRes.text() : ''

        // Si no hay texto exportable, intentar con el contenido directamente
        let raw = text
        if(!raw || raw.length < 50) {
          const binRes = await fetch(`https://www.googleapis.com/drive/v3/files/${pdf.id}?alt=media`, { headers:{Authorization:`Bearer ${t}`} })
          raw = await binRes.text()
        }

        const parsed = parseInvoice(raw)

        // Verificar si ya existe (por folio)
        const exists = billing.some(b=>b.invoice_no===parsed.folio)
        if(exists){ results.skipped++; addLog(`⏭ ${pdf.name} — ya existe`); setProgress(p=>({...p,done:p.done+1})); continue }

        // Buscar cliente por RUT o nombre
        let matchedClient = null
        if(parsed.rut) matchedClient = clients.find(c=>c.rut===parsed.rut)
        if(!matchedClient && parsed.cliente) matchedClient = clients.find(c=>c.name?.toLowerCase()===parsed.cliente?.toLowerCase())

        results.rows.push({ ...parsed, clientMatch: matchedClient, fileName: pdf.name })
        results.imported++
        addLog(`✓ ${pdf.name} — ${parsed.cliente||'?'} · $${parsed.total?.toLocaleString('es-CL')||'?'}`)
      } catch(e){
        results.errors++
        addLog(`✗ ${pdf.name} — error: ${e.message}`)
      }
      setProgress(p=>({...p,done:p.done+1}))
    }

    addLog(`─────────────────────────`)
    addLog(`✅ ${results.imported} procesadas · ⏭ ${results.skipped} ya existían · ❌ ${results.errors} errores`)
    setStep('done')
    onImported(results.rows)
  }

  return (
    <div>
      {step==='loading'&&<div style={{textAlign:'center',padding:20}}><Spin/><p style={{fontSize:13,color:C.muted,marginTop:12}}>Conectando con Drive…</p></div>}

      {step==='notoken'&&(
        <div style={{textAlign:'center',padding:20}}>
          <p style={{fontSize:13,color:C.text,marginBottom:16}}>Necesitas autorizar acceso a Google Drive para importar facturas.</p>
          <button onClick={connectDrive} style={{padding:'10px 20px',borderRadius:8,border:'none',background:C.accent,color:'#fff',fontSize:13,fontWeight:600,cursor:'pointer'}}>
            Autorizar Google Drive
          </button>
        </div>
      )}

      {step==='selectMonth'&&(
        <div>
          <p style={{fontSize:13,color:C.muted,marginBottom:12}}>Selecciona el año y mes a importar:</p>
          <div style={{display:'flex',gap:8,flexWrap:'wrap',marginBottom:16}}>
            {years.map(y=>(
              <button key={y.id} onClick={()=>loadMonths(y.id)} style={{padding:'6px 14px',borderRadius:8,border:`1px solid ${selYear===y.id?C.accent:C.border}`,background:selYear===y.id?'#E6EEF1':'#fff',color:selYear===y.id?C.accent:C.text,fontSize:13,fontWeight:600,cursor:'pointer'}}>{y.name}</button>
            ))}
          </div>
          {months.length>0&&(
            <>
              <p style={{fontSize:12,color:C.muted,marginBottom:8}}>Mes:</p>
              <div style={{display:'flex',gap:6,flexWrap:'wrap'}}>
                {months.map(m=>(
                  <button key={m.id} onClick={()=>importMonth(m.id,m.name)} style={{padding:'6px 14px',borderRadius:8,border:`1px solid ${C.border}`,background:'#fff',color:C.text,fontSize:13,cursor:'pointer'}}>{m.name}</button>
                ))}
              </div>
            </>
          )}
        </div>
      )}

      {(step==='importing'||step==='done')&&(
        <div>
          {step==='importing'&&<div style={{display:'flex',alignItems:'center',gap:8,marginBottom:12}}><Spin/><span style={{fontSize:13,color:C.muted}}>{progress.done}/{progress.total} facturas…</span></div>}
          <div style={{background:'#F7F7F7',borderRadius:8,padding:'10px 12px',maxHeight:260,overflowY:'auto',fontSize:12,fontFamily:'monospace',color:C.text,lineHeight:1.6}}>
            {log.map((l,i)=><div key={i}>{l}</div>)}
          </div>
          {step==='done'&&<button onClick={onClose} style={{marginTop:14,width:'100%',padding:11,borderRadius:10,border:'none',background:C.accent,color:'#fff',fontSize:13,fontWeight:600,cursor:'pointer'}}>Cerrar</button>}
        </div>
      )}

      {step==='error'&&<div style={{color:C.overdue,fontSize:13,textAlign:'center',padding:20}}>Error al conectar con Drive. Intenta cerrar sesión y volver a entrar.</div>}
    </div>
  )
}

export default function App() {
  const [session, setSession] = useState(null)
  const [loadingAuth, setLoadingAuth] = useState(true)
  const [user, setUser] = useState(null)
  const [clients, setClients] = useState([])
  const [matters, setMatters] = useState([])
  const [billing, setBilling] = useState([])
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [tab, setTab] = useState('dashboard')
  const [hideErasmo, setHideErasmo] = useState(true)
  const [modal, setModal] = useState(null)
  const [importedRows, setImportedRows] = useState([])

  useEffect(()=>{
    getSession().then(({data:{session}})=>{
      setSession(session)
      if(session) setUser(getUserInfo(session.user.email))
      setLoadingAuth(false)
    })
    const {data:{subscription}} = onAuthChange((_,session)=>{
      setSession(session)
      if(session){
        setUser(getUserInfo(session.user.email))
        if(session.provider_token) saveDriveToken(session.provider_token)
      } else setUser(null)
    })
    return ()=>subscription.unsubscribe()
  },[])

  useEffect(()=>{
    if(!session) return
    setLoading(true)
    Promise.all([getClients(),getMatters(),getBilling()])
      .then(([c,m,b])=>{setClients(c);setMatters(m);setBilling(b)})
      .catch(console.error)
      .finally(()=>setLoading(false))
  },[session])

  const handleSaveClient = useCallback(async(f)=>{
    setSaving(true)
    try {
      const payload = {...f, name:f.name.trim(), updated_at: new Date().toISOString()}
      if(payload.status!=='Terminado') payload.ended_at = null
      else if(!payload.ended_at) payload.ended_at = new Date().toISOString().slice(0,10)
      const saved = await upsertClient(payload)
      setClients(p=>{
        const next = f.id ? p.map(x=>x.id===saved.id?saved:x) : [...p, saved]
        return next.sort((a,b)=>(a.name||'').localeCompare(b.name||'','es'))
      })
      setModal(null)
    } catch(e){ alert('Error al guardar: '+e.message) }
    setSaving(false)
  },[])

  const handleDeleteClient = useCallback(async(id)=>{
    if(!confirm('¿Eliminar este cliente? Se eliminarán también sus asuntos y cobros asociados.')) return
    try {
      await dbDeleteClient(id)
      setClients(p=>p.filter(x=>x.id!==id))
      setMatters(p=>p.filter(m=>m.client_id!==id))
      setBilling(p=>p.filter(b=>b.client_id!==id))
      setModal(null)
    } catch(e){ alert('Error al eliminar: '+e.message) }
  },[])

  const handleSaveMatter = useCallback(async(f)=>{
    setSaving(true)
    try {
      const saved = await upsertMatter({...f, updated_at: new Date().toISOString()})
      setMatters(p=>f.id ? p.map(x=>x.id===f.id?{...saved,clients:x.clients}:x) : [{...saved,clients:clients.find(c=>c.id===saved.client_id)}, ...p])
      setModal(null)
    } catch(e){ alert('Error al guardar: '+e.message) }
    setSaving(false)
  },[clients])

  const handleDeleteMatter = useCallback(async(id)=>{
    if(!confirm('¿Eliminar este asunto?')) return
    await dbDeleteMatter(id)
    setMatters(p=>p.filter(x=>x.id!==id))
    setModal(null)
  },[])

  const handleSaveBilling = useCallback(async(f)=>{
    setSaving(true)
    try {
      const payload = {
        ...f,
        amount: parseInt(f.amount)||0,
        updated_at: new Date().toISOString()
      }
      const saved = await upsertBilling(payload)
      setBilling(p=>{
        const withClient = {...saved, clients: clients.find(c=>c.id===saved.client_id), erasmo: f.erasmo}
        return f.id ? p.map(x=>x.id===saved.id?withClient:x) : [withClient,...p]
      })
      setModal(null)
    } catch(e){ alert('Error al guardar: '+e.message) }
    setSaving(false)
  },[clients])

  const handleStatusChange = useCallback(async(id,status)=>{
    await updateBillingStatus(id,status)
    setBilling(p=>p.map(x=>x.id===id?{...x,status}:x))
  },[])

  const urgentN = useMemo(()=>{
    const mm=hideErasmo?matters.filter(m=>!m.clients?.erasmo):matters
    return mm.filter(m=>['overdue','urgent'].includes(urgency(m.due,m.status))).length
  },[matters,hideErasmo])
  const overdueN = useMemo(()=>{
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
        option{background:#fff;color:${C.text}}
        @keyframes spin{to{transform:rotate(360deg)}}
        @media(min-width:680px){
          .shell{max-width:600px;margin:0 auto;box-shadow:0 0 0 1px ${C.border},0 12px 50px rgba(0,0,0,.08);min-height:100vh}
          .bottomnav{max-width:600px;left:50%!important;right:auto!important;transform:translateX(-50%);border-left:1px solid ${C.border};border-right:1px solid ${C.border}}
          .bottomnav button{padding:12px 0 10px}
          .bottomnav button span:first-child{font-size:18px}
          .bottomnav button span:last-child{font-size:11px}
          .fab{right:auto!important;left:50%!important;margin-left:228px}
        }
      `}</style>

      <div className='shell' style={{background:C.bg,minHeight:'100vh',position:'relative'}}>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'52px 20px 4px',position:'sticky',top:0,background:C.bg,zIndex:20}}>
          <button onClick={signOut} style={{background:'none',border:'none',color:C.muted,fontSize:11,cursor:'pointer',fontWeight:500}}>{user?.name} · Salir</button>
          <button onClick={()=>setHideErasmo(h=>!h)} style={{padding:'5px 12px',borderRadius:20,border:`1px solid ${hideErasmo?C.accent:C.border}`,background:hideErasmo?'#E6EEF1':'transparent',color:hideErasmo?C.accent:C.muted,fontSize:11,fontWeight:600,cursor:'pointer'}}>
            {hideErasmo?'Solo Cristóbal':'Todo el estudio'}
          </button>
        </div>

        {loading ? (
          <div style={{display:'flex',alignItems:'center',justifyContent:'center',height:'60vh'}}><Spin/></div>
        ) : (
          <div style={{paddingBottom:80,overflowY:'auto'}}>
            {tab==='dashboard'&&<Dashboard matters={matters} billing={billing} clients={clients} hideErasmo={hideErasmo} setTab={setTab} user={user}/>}
            {tab==='matters'&&<MattersView matters={matters} clients={clients} hideErasmo={hideErasmo} onEdit={m=>setModal({type:'matter',data:m})} onAdd={()=>setModal({type:'matter',data:null})}/>}
            {tab==='tasks'&&<TasksView matters={matters} hideErasmo={hideErasmo} onEdit={m=>setModal({type:'matter',data:m})}/>}
            {tab==='billing'&&<BillingView billing={billing} clients={clients} hideErasmo={hideErasmo} onStatusChange={handleStatusChange} onAdd={()=>setModal({type:'billing',data:null})} onEdit={b=>setModal({type:'billing',data:b})} onImport={()=>setModal({type:'drive',data:null})}/>}
            {tab==='clients'&&<ClientsView clients={clients} matters={matters} billing={billing} hideErasmo={hideErasmo} onEdit={c=>setModal({type:'client',data:c})} onAdd={()=>setModal({type:'client',data:null})}/>}
          </div>
        )}

        <BottomNav tab={tab} setTab={setTab} urgentN={urgentN} overdueN={overdueN}/>

        <button className='fab' onClick={()=>setModal(tab==='clients'?{type:'client',data:null}:tab==='billing'?{type:'billing',data:null}:{type:'matter',data:null})} style={{position:'fixed',bottom:24,right:20,width:52,height:52,borderRadius:'50%',background:C.accent,border:'none',cursor:'pointer',fontSize:24,color:'#fff',display:'flex',alignItems:'center',justifyContent:'center',boxShadow:'0 6px 20px rgba(0,60,80,.32)',zIndex:100}}>+</button>

        {modal?.type==='matter'&&(
          <Modal title={modal.data?.id?'Editar asunto':'Nuevo asunto'} onClose={()=>setModal(null)}>
            <MatterForm matter={modal.data} clients={clients} onSave={handleSaveMatter} onClose={()=>setModal(null)} onDelete={handleDeleteMatter} saving={saving}/>
          </Modal>
        )}
        {modal?.type==='billing'&&(
          <Modal title={modal.data?.id?'Editar cobro':'Nuevo cobro'} onClose={()=>setModal(null)}>
            <BillingForm bill={modal.data} clients={clients} onSave={handleSaveBilling} onClose={()=>setModal(null)} saving={saving}/>
          </Modal>
        )}
        {modal?.type==='drive'&&(
          <Modal title='Importar facturas desde Drive' onClose={()=>setModal(null)}>
            <DriveImporter clients={clients} billing={billing} onImported={(rows)=>{setImportedRows(rows);if(rows.length===0)setModal(null)}} onClose={()=>setModal(null)}/>
          </Modal>
        )}
        {modal?.type==='client'&&(
          <Modal title={modal.data?.id?'Editar cliente':'Nuevo cliente'} onClose={()=>setModal(null)}>
            <ClientForm client={modal.data} onSave={handleSaveClient} onClose={()=>setModal(null)} onDelete={handleDeleteClient} saving={saving}/>
          </Modal>
        )}
      </div>
    </>
  )
}
