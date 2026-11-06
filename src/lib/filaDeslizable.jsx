import { useState, useRef } from 'react'
import { C } from './base.jsx'

// ─── Fila deslizable (celular): al deslizar hacia la izquierda aparecen sus acciones DENTRO de la fila (no flotan) ──
// acciones = [{ etiqueta, color, fondo, onClick }]. En escritorio no desliza (las acciones están a la vista o al pasar el mouse).
export function FilaDeslizable({acciones=[], activo=true, children, radio=8, fondo=C.card}){   // fondo: color opaco de la fila (tapa los botones de atrás); igual al de la lista para que no cambie su aspecto
  const ANCHO=78, total=acciones.length*ANCHO
  const [dx,setDx]=useState(0), [abierta,setAbierta]=useState(false)
  const g=useRef(null)
  if(!activo||!acciones.length) return children
  const down=e=>{ if(e.pointerType==='mouse') return; g.current={x0:e.clientX,y0:e.clientY,base:abierta?-total:0,eje:null,t0:Date.now()} }
  const move=e=>{ const s=g.current; if(!s) return; const mx=e.clientX-s.x0, my=e.clientY-s.y0
    if(!s.eje){ if(Math.hypot(mx,my)<8) return; s.eje=Date.now()-s.t0>350?'arrastre':Math.abs(mx)>Math.abs(my)?'x':'y' }   // quieto antes de moverse = arrastre (useArrastre)
    if(s.eje!=='x') return
    setDx(Math.max(-total-24,Math.min(0,s.base+mx))) }
  const up=()=>{ const s=g.current; g.current=null; if(!s||s.eje!=='x') return
    const abrir=dx<-total/2; setAbierta(abrir); setDx(abrir?-total:0) }
  const cerrar=()=>{ setAbierta(false); setDx(0) }
  return (
    <div style={{position:'relative',overflow:'hidden',borderRadius:radio}}>
      <div style={{position:'absolute',top:0,right:0,bottom:0,display:'flex'}}>
        {acciones.map((a,i)=><button key={i} onClick={e=>{ e.stopPropagation(); cerrar(); a.onClick&&a.onClick() }} style={{width:ANCHO,border:'none',background:a.fondo||C.accent,color:a.color||'#fff',fontSize:12,fontWeight:700,cursor:'pointer',fontFamily:'inherit'}}>{a.etiqueta}</button>)}
      </div>
      <div onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={()=>{ g.current=null; setDx(abierta?-total:0) }}
        onClickCapture={e=>{ if(abierta){ e.stopPropagation(); e.preventDefault(); cerrar() } }}
        style={{position:'relative',transform:`translateX(${dx}px)`,transition:g.current?'none':'transform .2s ease',touchAction:'pan-y',background:fondo}}>
        {children}
      </div>
    </div>
  )
}
