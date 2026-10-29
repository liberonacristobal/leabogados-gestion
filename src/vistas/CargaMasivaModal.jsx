// Movido desde App.jsx por scripts/mover-a-modulo.py. Sin cambios de comportamiento.
import { useState, useEffect, useMemo, useRef } from 'react'
import { supabase, DEMO } from '../supabase'
import { normRut as crNormRut } from '../cartola.js'
import { VENTA_REAL, glosaKey, sugerirVentaGasto } from '../../supabase/functions/_shared/ventaGastoReglas.js'
import { BRAND, C, Gl, SEC_LBL, Spin, appAlert, appConfirm, fmt, fmtFechaDMY, fmtRutCL, personChip, useIsDesktop } from '../lib/base.jsx'
import { AsignarClienteInline, Modal, NOTA_DIRIGIDO, _fechaISO, canonOtNN, cargarAdminsEstudio, claudeCall, driveCall, enviarComoUsuario, learnPut, normRut, pillPersonaSty, proyectoSeguro, saldoCliente, setLearningKV, txtEnviado, useAprendidosVenta } from '../lib/compartido.jsx'

// Compareciente vacío o de relleno ("N/A", "S/N", "-"): no identifica a nadie → no se propaga ni se aprende como alias.
export const sinNombreReal = s => !String(s||'').replace(/^\s*(n\/?a\.?|s\/?n|sin (nombre|datos)|-+)\s*$/i,'').trim()

// Último registro de una bitácora (activity_log por prefijo) → render(row|null). Para tarjetas-resumen que abren la bitácora completa.
// Toca una vez, al montar, el botón que calza con el selector (p. ej. «Analizar» de la liquidación que llegó por correo).
// Clic automático una sola vez por clave (no por montaje): si el paso falla y el componente se vuelve a montar, no repite el clic en bucle.
export const _autoClickHechos = new Set()

export function AutoClick({sel, clave}){ useEffect(()=>{ const k=clave||sel; if(_autoClickHechos.has(k)) return; _autoClickHechos.add(k); const b=document.querySelector(sel); if(b) b.click() },[sel,clave]); return null }

// Modal de confirmación para deshacer una carga masiva (elimina sus gastos).
export function UndoConfirm({target,undoing,onCancel,onConfirm}) {
  return (
    <div style={{position:'fixed',inset:0,background:'rgba(20,30,35,.45)',zIndex:400,display:'flex',alignItems:'center',justifyContent:'center',padding:20}} onClick={e=>e.target===e.currentTarget&&onCancel()}>
      <div style={{background:'#fff',borderRadius:14,width:'100%',maxWidth:340,padding:20,boxShadow:'0 16px 40px rgba(0,0,0,.2)'}}>
        <div style={{fontSize:16,fontWeight:600,color:C.text,marginBottom:9,fontFamily:"'DM Sans',sans-serif"}}>Deshacer importación</div>
        <div style={{fontSize:12,color:C.muted,lineHeight:1.5,marginBottom:18}}>Se eliminan los <strong style={{color:C.text}}>{target.count} gasto{target.count!==1?'s':''}</strong> de esta carga (incluye editados). No se puede revertir.</div>
        <div style={{display:'flex',gap:8}}>
          <button onClick={onCancel} style={{flex:1,padding:11,borderRadius:10,border:`0.5px solid ${C.border}`,background:'#fff',color:C.muted,fontSize:13,fontWeight:600,cursor:'pointer'}}>Cancelar</button>
          <button disabled={undoing} onClick={onConfirm} style={{flex:1,padding:11,borderRadius:10,border:'none',background:C.overdue,color:'#fff',fontSize:13,fontWeight:600,cursor:undoing?'default':'pointer',opacity:undoing?.6:1}}>{undoing?'Eliminando…':'Sí, eliminar todo'}</button>
        </div>
      </div>
    </div>
  )
}

export function CargaMasivaModal({clients,clientEntities,expenses=[],sales=[],billing=[],onSave,onBulkImport,onConciliar,onAjustarNotaria,onUndoConciliar,bulkImports=[],onUndoImport,importAliases=[],onLearnAlias,onClose,onClientsUpdate,notaria=false,onCreateOccasional,onNavigate,dirtyRef,cajaPorDefecto='',archivoCorreo=null}) {
  const [tipo,setTipo] = useState('gasto') // gasto | fondo
  const isDeskCM = useIsDesktop()   // escritorio: revisión en 2 columnas y filas de notaría en grilla alineada (móvil intacto)
  // Notaría: modo SIMPLE = cola de confirmación 1×1 (sugerencia + Confirmar por fila, solo importa lo confirmado, muestra todo el documento).
  // Resto: modo conciliar (actualiza lo existente + importa lo nuevo). El anti-duplicados por OT (handleBulkImport) igual protege en simple.
  const [modo,setModo] = useState(notaria?'importar':'conciliar')
  const [noTocarRendidos,setNoTocarRendidos] = useState(true)  // en conciliar, no cambiar cliente de gastos ya rendidos
  const [showRend,setShowRend] = useState(false)   // ver detalle de rendidos que calzaron
  const [showDup,setShowDup] = useState(false)     // ver detalle de duplicados del archivo
  const [concilOpen,setConcilOpen] = useState(null)  // sección del acordeón de conciliación abierta
  const [concilExcl,setConcilExcl] = useState(()=>new Set())  // filas destildadas (se excluyen de corregir/importar)
  const toggleExcl = k => setConcilExcl(p=>{ const n=new Set(p); n.has(k)?n.delete(k):n.add(k); return n })
  const [concilQ,setConcilQ] = useState('')                   // buscador dentro de las listas de conciliación
  const [concilGrp,setConcilGrp] = useState(()=>new Set())    // grupos (cliente) expandidos
  const toggleGrp = k => setConcilGrp(p=>{ const n=new Set(p); n.has(k)?n.delete(k):n.add(k); return n })
  const [concilMatch,setConcilMatch] = useState({})           // override de calce manual: rowId → gastoId
  const [forzarNuevo,setForzarNuevo] = useState(()=>new Set())// filas forzadas a importarse como nuevas (no calzar)
  const [matchPick,setMatchPick] = useState(null)             // rowId con el selector "otro calce" abierto
  const [chgFilter,setChgFilter] = useState('all')            // filtro de Corregir: all | cli (cambian cliente) | cat (cambian categoría)
  const [posibleDec,setPosibleDec] = useState({})             // decisión por posible duplicado: rowId → 'omitir' | 'cargar'
  const [posOpen,setPosOpen] = useState(true)                 // grupo "posibles duplicados" abierto
  const [posExp,setPosExp] = useState(null)                   // rowId del posible con la comparación expandida
  const [cajaOwner,setCajaOwner] = useState(()=>notaria?'':(cajaPorDefecto||''))   // dueño de la caja chica (un miembro del equipo carga lo que pagó con SU caja; la notaría la paga la oficina): estos gastos van a su caja (created_by = su NOMBRE, igual que un gasto normal)
  // El dueño por defecto (usuario limited) vale para los gastos NUEVOS; reasignar gastos que ya existen exige elegirlo a mano.
  const [cajaElegida,setCajaElegida] = useState(false)
  const cajaReasigna = cajaElegida ? cajaOwner : ''
  // Categorías aprendidas (glosa→categoría, mismo learning que el Asistente IA): pre-rellena la carga cuando la planilla no trae categoría.
  const catLearnRef = useRef({})
  useEffect(()=>{ let on=true; supabase.from('learnings').select('key,value').eq('kind','gasto_categoria').order('updated_at',{ascending:true}).then(({data})=>{ if(!on)return; const m={}; (data||[]).forEach(r=>{ if(r.key&&r.value) m[r.key]=r.value }); catLearnRef.current=m }); return ()=>{on=false} },[])
  const toggleForzar = id => setForzarNuevo(p=>{ const n=new Set(p); n.has(id)?n.delete(id):n.add(id); return n })
  // Memoria del lote: persiste reasignaciones de calce y "forzar nuevo" por huella de fila (cliente+monto+glosa),
  // para que al re-subir el MISMO archivo se retomen tus decisiones (filosofía: la app aprende, no repite).
  const rowKeyHuella = r=>`${r.client_id||r.nombre||''}|${r.monto||0}|${(r.concepto||'').toLowerCase().replace(/\s+/g,' ').trim().slice(0,40)}`
  const [showRecientes,setShowRecientes] = useState(false)   // modo notaría: importaciones recientes plegadas
  const [rows,setRows] = useState(null)    // null = sin cargar
  // OT que ya marcaste como "no nuestra" en cargas anteriores (tabla notaria_no_nuestras): al volver en otra liquidación
  // se reconocen solas (no se cargan ni hay que volver a marcarlas). "Volver a la revisión" la reactiva si sí era nuestra.
  const [noNKnown,setNoNKnown] = useState(null)
  useEffect(()=>{ if(DEMO) return; supabase.from('notaria_no_nuestras').select('ot,estado,resolucion,created_at,consultada_at').then(({data})=>{ const m={}; (data||[]).forEach(r=>{ if(r.resolucion==='era_nuestra') return; const k=canonOtNN(r.ot); if(k) m[k]=r }); setNoNKnown(m) }).catch(()=>{}) },[])
  useEffect(()=>{ if(!noNKnown||!rows||!rows.length) return
    if(!rows.some(r=>!r._noNChk)) return
    setRows(p=>(p||[]).map(r=>{ if(r._noNChk) return r; const kn=!r.noNuestra&&noNKnown[canonOtNN(r.ot)]
      return kn ? {...r,_noNChk:true,noNuestra:true,noNPrev:kn,client_id:null,clientName:null,entity_id:null,personal_de:null,suggestion:null,candidates:null} : {...r,_noNChk:true} }))
  },[noNKnown,rows])
  const [fileName,setFileName] = useState('')
  const [cargando,setCargando] = useState(false)
  const [guardando,setGuardando] = useState(false)
  const [resultado,setResultado] = useState(null)   // {imported,dupOmit,sinCliente,sinFecha,batchId}
  const [undoTarget,setUndoTarget] = useState(null)  // {batchId,count} para el modal de confirmación
  const [undoing,setUndoing] = useState(false)
  const fmtFDMY = iso => { if(!iso) return '—'; const p=String(iso).slice(0,10).split('-'); return p.length===3?`${p[2]}-${p[1]}-${p[0]}`:String(iso) }
  const [genPlantilla,setGenPlantilla] = useState(false)
  const [matching,setMatching] = useState(false)        // análisis de matching/IA en curso
  const [readyBanner,setReadyBanner] = useState(false)   // aviso "análisis listo · a revisar" al terminar de leer
  const [respFilter,setRespFilter] = useState(null)      // filtro del preview por abogado responsable ('__sin__' = sin responsable)
  const [bucketFilter,setBucketFilter] = useState(null)  // filtro del preview por bucket (auto/sug/rev/man); clic en el chip filtra la lista
  const respDeRow = r => (r.client_id ? (clients.find(c=>String(c.id)===String(r.client_id))?.abogado_responsable||null) : null)
  const [matchProg,setMatchProg] = useState(null)       // {done,total} de lotes IA

  const normRut = crNormRut   // normalizador único de RUT
  // Categorías válidas del sistema (mismas que GastosForm). No se crean nuevas desde el Excel.
  const CAT_OPCIONES = ['Notaria','CBR','Diario Oficial','Registro Civil','Otro']
  const catNorm = s => (s||'').toString().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim()
  const canonCat = raw => CAT_OPCIONES.find(c=>catNorm(c)===catNorm(raw)) || 'Otro'
  // Razones sociales (entidades) del cliente
  const entsOf = cid => (clientEntities||[]).filter(e=>e.client_id===cid)
  // Fila lista para cargar: con cliente, sin error y con razón social resuelta (auto si 1, elegida si varias)
  const rowReady = r => (!!r.client_id || !!r.personal_de) && !r.error && (!!r.personal_de || entsOf(r.client_id).length<=1 || !!r.entity_id)

  // ExcelJS (escritura con estilos/validación/comentarios — SheetJS community no los soporta) cargado por CDN al descargar
  const loadExcelJS = () => new Promise((resolve,reject)=>{
    if(window.ExcelJS) return resolve(window.ExcelJS)
    const s=document.createElement('script')
    s.src='https://cdn.jsdelivr.net/npm/exceljs@4.4.0/dist/exceljs.min.js'
    s.onload=()=>window.ExcelJS?resolve(window.ExcelJS):reject(new Error('ExcelJS no disponible'))
    s.onerror=()=>reject(new Error('No se pudo cargar la librería de Excel'))
    document.head.appendChild(s)
  })

  const descargarPlantilla = async() => {
    setGenPlantilla(true)
    try{
      const ExcelJS = await loadExcelJS()
      const wb = new ExcelJS.Workbook()
      const headFill = {type:'pattern',pattern:'solid',fgColor:{argb:'FFE4E8EB'}}
      const headFont = {bold:true}
      const cats = '"'+CAT_OPCIONES.join(',')+'"'  // solo categorías válidas del sistema
      const estilarHeader = ws => ws.getRow(1).eachCell(c=>{ c.font=headFont; c.fill=headFill })

      // Hoja Gastos
      const g = wb.addWorksheet('Gastos')
      g.columns=[
        {header:'RUT',key:'rut',width:16},
        {header:'Nombre',key:'nombre',width:28},
        {header:'Fecha',key:'fecha',width:13},
        {header:'Monto',key:'monto',width:13},
        {header:'Concepto',key:'concepto',width:28},
        {header:'Subconcepto',key:'subconcepto',width:32},
        {header:'OT',key:'ot',width:12},
        {header:'Categoría',key:'categoria',width:16},
        {header:'Caja chica',key:'caja_chica',width:13},
      ]
      g.addRow({rut:'76.123.456-7',nombre:'Inmobiliaria Andes SpA',fecha:new Date(2026,5,3),monto:45000,concepto:'Inscripción en Conservador de Bienes Raíces',categoria:'CBR',caja_chica:'sí'})
      g.addRow({rut:'12.345.678-9',nombre:'Juan Pérez Soto',fecha:new Date(2026,5,5),monto:18000,concepto:'Transporte a notaría',categoria:'Otro'})
      g.addRow({rut:'77.700.111-2',nombre:'Comercial Sur Ltda.',fecha:new Date(2026,5,8),monto:30000,concepto:'Escritura pública',subconcepto:'Compraventa lote 4, Chicureo',ot:'OT-1284',categoria:'Notaria'})
      g.addRow({rut:'77.700.111-2',nombre:'Comercial Sur Ltda.',fecha:new Date(2026,5,8),monto:30000,concepto:'Escritura pública',subconcepto:'Constitución de sociedad',ot:'OT-1290',categoria:'Notaria'})
      g.getColumn('fecha').numFmt='dd-mm-yyyy'
      g.getColumn('monto').numFmt='#,##0'
      estilarHeader(g)
      g.getCell('A1').note='Acepta RUT con o sin puntos/guión (ej: 76.123.456-7 o 761234567)'
      g.getCell('D1').note='Monto en pesos, mayor a 0 y sin decimales'
      g.getCell('I1').note='sí = pagado con cargo a la caja chica · no = pagado por el cliente. Déjalo vacío si no corresponde.'
      for(let r=2;r<=200;r++){ g.getCell('F'+r).dataValidation={type:'list',allowBlank:true,formulae:[cats]}; g.getCell('I'+r).dataValidation={type:'list',allowBlank:true,formulae:['"sí,no"']} }

      // Hoja Fondos
      const f = wb.addWorksheet('Fondos')
      f.columns=[
        {header:'RUT',key:'rut',width:16},
        {header:'Nombre',key:'nombre',width:28},
        {header:'Fecha',key:'fecha',width:13},
        {header:'Monto',key:'monto',width:13},
        {header:'Concepto',key:'concepto',width:32},
      ]
      f.addRow({rut:'76.123.456-7',nombre:'Inmobiliaria Andes SpA',fecha:new Date(2026,5,1),monto:200000,concepto:'Provisión de fondos para gastos notariales'})
      f.addRow({rut:'77.700.111-2',nombre:'Comercial Sur Ltda.',fecha:new Date(2026,5,2),monto:150000,concepto:'Fondo inicial'})
      f.getColumn('fecha').numFmt='dd-mm-yyyy'
      f.getColumn('monto').numFmt='#,##0'
      estilarHeader(f)
      f.getCell('A1').note='Acepta RUT con o sin puntos/guión'
      f.getCell('D1').note='Monto en pesos, mayor a 0 y sin decimales'

      // Hoja Instrucciones
      const ins = wb.addWorksheet('Instrucciones')
      ins.getColumn(1).width=120
      const txt=[
        ['INSTRUCCIONES — CARGA MASIVA DE GASTOS Y FONDOS',true],
        ['',false],
        ['Columnas obligatorias: RUT (o Nombre) y Monto. Recomendado incluir Fecha.',false],
        ['Columnas opcionales: Concepto, Subconcepto (detalle que distingue gastos con igual concepto, ej. notaría), OT (N° de orden de la notaría, ej. OT-1284) y, solo en Gastos, Categoría (si no se indica, se usa "Otro").',false],
        ['',false],
        ['Formato de RUT: con o sin puntos y guión. Ejemplos válidos: 76.123.456-7, 761234567, 76123456-7.',false],
        ['Formato de fecha: dd-mm-yyyy, dd/mm/yyyy o yyyy-mm-dd. Ejemplos: 03-06-2026, 03/06/2026, 2026-06-03. Si se omite, se usa la fecha de carga.',false],
        ['',false],
        ['Cliente: se busca por RUT y, si no hay coincidencia, por Nombre exacto. Las filas sin cliente quedan en AMARILLO en la vista previa para asignarlas a mano antes de cargar.',false],
        ['',false],
        ['Razón social: si el cliente tiene una sola razón social, se asigna automáticamente. Si tiene más de una, deberás elegirla en la vista previa antes de cargar (la fila queda en AMARILLO hasta que la elijas).',false],
        ['',false],
        ['Categoría: solo se pueden usar las categorías del sistema (Notaria, CBR, Diario Oficial, Registro Civil, Otro). No se pueden crear categorías nuevas desde el Excel; si no encaja ninguna, usa "Otro" y detalla en Concepto.',false],
        ['',false],
        ['Monto: número mayor a 0, sin decimales. Las filas con monto menor o igual a 0 (incluidos negativos) se marcan como ERROR (rojo) y NO se cargan.',false],
        ['',false],
        ['Duplicados: la vista previa avisa si detecta filas duplicadas (mismo RUT, fecha, monto, concepto, subconcepto y OT). Si dos gastos tienen el mismo concepto pero distinto subconcepto u OT, NO se marcan como duplicados.',false],
        ['',false],
        ['Hoja "Gastos": RUT | Nombre | Fecha | Monto | Concepto | Subconcepto | OT | Categoría. Subconcepto y OT distinguen gastos de notaría con el mismo concepto (evitan falsos duplicados) y el OT aparece en la rendición al cliente.',false],
        ['Hoja "Fondos": RUT | Nombre | Fecha | Monto | Concepto.',false],
        ['Al cargar en la app eliges si subes Gastos o Fondos; se lee la hoja correspondiente.',false],
      ]
      txt.forEach((t,i)=>{ const cell=ins.getRow(i+1).getCell(1); cell.value=t[0]; if(t[1]) cell.font={bold:true} })

      const buf=await wb.xlsx.writeBuffer()
      const blob=new Blob([buf],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'})
      const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download='Plantilla_carga_masiva.xlsx'; a.click(); URL.revokeObjectURL(a.href)
    }catch(e){ appAlert('Error al generar la plantilla: '+e.message) }
    setGenPlantilla(false)
  }

  // Modelo Excel ESPECÍFICO de notaría: hoja "Gastos" (la lee el parser con tipo gasto), Categoría=Notaria precargada,
  // y las columnas Subconcepto + OT destacadas (distinguen gastos con igual concepto y el OT va a la rendición).
  const descargarPlantillaNotaria = async() => {
    setGenPlantilla(true)
    try{
      const ExcelJS = await loadExcelJS()
      const wb = new ExcelJS.Workbook()
      const headFont={bold:true}, headFill={type:'pattern',pattern:'solid',fgColor:{argb:'FFE4E8EB'}}
      const g = wb.addWorksheet('Gastos')
      g.columns=[
        {header:'OT',key:'ot',width:12},
        {header:'Requirente',key:'requirente',width:26},
        {header:'Materia',key:'materia',width:22},
        {header:'Fecha',key:'fecha',width:13},
        {header:'Monto',key:'monto',width:13},
        {header:'Concepto',key:'concepto',width:24},
        {header:'Subconcepto',key:'subconcepto',width:34},
        {header:'RUT',key:'rut',width:16},
        {header:'Nombre',key:'nombre',width:28},
        {header:'Categoría',key:'categoria',width:14},
      ]
      g.addRow({ot:'OT-1284',requirente:'Inmobiliaria Vista',materia:'Compraventa',fecha:new Date(2026,2,12),monto:90000,concepto:'Escritura pública',subconcepto:'Lote 4, Chicureo',categoria:'Notaria'})
      g.addRow({ot:'OT-1290',requirente:'Inmob. Vista SpA',materia:'Constitución SpA',fecha:new Date(2026,2,12),monto:90000,concepto:'Escritura pública',subconcepto:'Sociedad por acciones',categoria:'Notaria'})
      g.addRow({ot:'OT-1305',requirente:'Trans Alerce',materia:'Poder',fecha:new Date(2026,2,14),monto:14000,concepto:'Copia con vigencia',subconcepto:'Poder especial',categoria:'Notaria'})
      g.getColumn('fecha').numFmt='dd-mm-yyyy'; g.getColumn('monto').numFmt='#,##0'
      g.getRow(1).eachCell(c=>{ c.font=headFont; c.fill=headFill })
      // Validación: Categoría sugerida Notaria (lista de categorías válidas)
      const cats='"'+CAT_OPCIONES.join(',')+'"'
      for(let i=2;i<=200;i++){ g.getCell(`J${i}`).dataValidation={type:'list',allowBlank:true,formulae:[cats]} }
      const ins = wb.addWorksheet('Instrucciones')
      ins.columns=[{header:'Cómo usar este modelo (Notaría)',key:'t',width:100}]
      ;[
        'Una fila por OT. La notaría manda OT, Requirente, Materia, Fecha, Monto y Concepto — normalmente NO manda el cliente. Requirente y Materia son las señales con que la app sugiere el cliente sola; RUT/Nombre son opcionales si los tienes.',
        'Subconcepto: el detalle que distingue gastos con el MISMO concepto (ej. "Compraventa lote 4" vs "Constitución de sociedad"). Evita que se marquen como duplicados.',
        'OT: el número de orden de la notaría (ej. OT-1284). Se guarda y aparece en la rendición al cliente y queda asociado a la rendición para cruzarlo con la notaría.',
        'Categoría: dejar "Notaria". La IA corrige la redacción y compone la glosa (Concepto + Subconcepto) al cargar.',
        'Dos filas con igual RUT, fecha, monto y concepto pero distinto Subconcepto u OT NO son duplicados.',
        'Gasto personal de un miembro de la oficina: en la columna Cliente escribe "Personal · Martín" (o el miembro que sea). Se carga como gasto personal de esa persona, no como cliente.',
        'Si la notaría incluye un trámite que NO es nuestro (ni de un cliente ni de la oficina): no lo cargues, elimina esa fila.',
      ].forEach(t=>ins.addRow({t}))
      ins.getRow(1).eachCell(c=>{ c.font=headFont; c.fill=headFill })
      const buf=await wb.xlsx.writeBuffer()
      const blob=new Blob([buf],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'})
      const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download='Modelo_notaria.xlsx'; a.click(); URL.revokeObjectURL(a.href)
    }catch(e){ appAlert('Error al generar el modelo: '+e.message) }
    setGenPlantilla(false)
  }

  // ── MOTOR DE MATCHING (Commit 2) ──────────────────────────────────────────
  // Nivel 1-2: exacto por RUT (cliente o razón social) o por nombre/razón social.
  const exactMatch = (rut,nombre) => {
    const nr = normRut(rut)
    if(nr){
      const c = clients.find(c=>normRut(c.rut)===nr); if(c) return {client:c,method:'rut_exact',entity_id:null}
      const e = (clientEntities||[]).find(e=>normRut(e.rut)===nr); if(e){ const cc=clients.find(c=>c.id===e.client_id); if(cc) return {client:cc,method:'rut_exact',entity_id:e.id} }
    }
    if(nombre){
      const nn = String(nombre).trim().toLowerCase()
      const c = clients.find(c=>c.name?.toLowerCase().trim()===nn || c.razon_social?.toLowerCase().trim()===nn); if(c) return {client:c,method:'name_exact',entity_id:null}
      const e = (clientEntities||[]).find(e=>e.name?.toLowerCase().trim()===nn); if(e){ const cc=clients.find(c=>c.id===e.client_id); if(cc) return {client:cc,method:'name_exact',entity_id:e.id} }
    }
    return {client:null,method:'none',entity_id:null}
  }

  // Memoria aprendida: nombre-crudo normalizado → cliente (de asignaciones manuales previas).
  const aliasMap = useMemo(()=>{ const m=new Map(); (importAliases||[]).forEach(a=>m.set(a.alias_norm,a.client_id)); return m },[importAliases])
  // Fuente extra de RUT→cliente: las facturas ya emitidas (billing.receptor_rut) — recupera clientes cuyo RUT no está en client_entities pero sí facturaste.
  const rutBillingMap = useMemo(()=>{ const m=new Map(); (billing||[]).forEach(b=>{ if(b.client_id&&b.receptor_rut){ const k=normRut(b.receptor_rut); if(k&&!m.has(k)) m.set(k,b.client_id) } }); return m },[billing])
  const aliasClient = nombre => { const k=String(nombre||'').toLowerCase().trim(); if(!k) return null; const cid=aliasMap.get(k); return cid?clients.find(c=>String(c.id)===String(cid)):null }

  // Nivel 3: fuzzy por distancia de Levenshtein normalizada contra nombre, razón social y razones sociales (client_entities).
  const STOP = new Set(['de','la','el','los','las','y','del','e','en','spa','ltda','sa','eirl','cia','limitada','sociedad','inversiones','inmobiliaria','comercial','servicios','grupo'])
  const levenshtein = (a,b) => {
    const m=a.length,n=b.length
    const dp=Array.from({length:m+1},(_,i)=>Array.from({length:n+1},(_,j)=>i===0?j:j===0?i:0))
    for(let i=1;i<=m;i++)for(let j=1;j<=n;j++)dp[i][j]=a[i-1]===b[j-1]?dp[i-1][j-1]:1+Math.min(dp[i-1][j],dp[i][j-1],dp[i-1][j-1])
    return dp[m][n]
  }
  const normName = s => String(s||'').toLowerCase()
    .replace(/\b(spa|s\.p\.a\.?|ltda\.?|limitada|s\.a\.?|y c[ií]a\.?|cia\.?|eirl)\b/gi,'')
    .replace(/[áàä]/g,'a').replace(/[éèë]/g,'e').replace(/[íìï]/g,'i').replace(/[óòö]/g,'o').replace(/[úùü]/g,'u').replace(/ñ/g,'n')
    .replace(/[^a-z0-9\s]/g,' ').replace(/\s+/g,' ').trim()
  const simil = (a,b) => { const x=normName(a),y=normName(b); if(!x||!y) return 0; const d=levenshtein(x,y); return Math.round((1-d/Math.max(x.length,y.length))*100) }
  const fuzzyScore = (rawName,client) => {
    const rn = normName(rawName); if(!rn) return 0
    const rWords = rn.split(' ').filter(w=>w.length>2&&!STOP.has(w))
    const variants = [client.name, client.razon_social, ...entsOf(client.id).map(e=>e.name)].filter(Boolean)
    let best = 0
    for(const v of variants){
      const nv = normName(v); if(!nv) continue
      let s = simil(rawName,v)
      if(nv.includes(rn)||rn.includes(nv)){ const r=Math.min(rn.length,nv.length)/Math.max(rn.length,nv.length); s += r>=0.7?20:10 }
      const vWords = new Set(nv.split(' ').filter(w=>w.length>2&&!STOP.has(w)))
      if(rWords.some(w=>vWords.has(w))) s += 15
      best = Math.max(best, Math.min(100,s))
    }
    return best
  }
  const candidatos = rawName => clients.map(c=>({c,score:fuzzyScore(rawName,c)})).filter(x=>x.score>0).sort((a,b)=>b.score-a.score)

  // ── Identificador de cliente para NOTARÍA (Pieza 3) ──────────────────────────
  // La notaría no manda el cliente: se deduce de requirente + materia + glosa contra un índice de tokens
  // distintivos (clientes + razones sociales + proyectos + receptores de factura + alias aprendidos). Estilo
  // conciliación: SOLO sugiere si los tokens apuntan a UN único cliente; si es ambiguo o nulo, NO adivina.
  const _NOTA_STOP = new Set(['sociedad','sociedades','anonima','compraventa','escritura','publica','poder','especial','copia','vigencia','constitucion','protocolizacion','acuerdo','mandato','contrato','notaria','notarial','inmobiliaria','comercial','servicios','inversiones','grupo','spa','ltda','limitada','eirl','para','por','con','del','los','las','una','uno','sobre','entre','este','esta'])
  const _toksNota = s => [...new Set(String(s||'').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/[^a-z0-9 ]/g,' ').split(/\s+/).filter(w=>w.length>=4 && !_NOTA_STOP.has(w)))]
  // Proyecto aprendido por cliente + sociedad de la OT (learnings 'notaria_proyecto': `${client_id}::${entity_id|compareciente}` → sale_id).
  const [notaProyL,setNotaProyL] = useState({})
  useEffect(()=>{ if(!notaria||DEMO) return; supabase.from('learnings').select('key,value').eq('kind','notaria_proyecto').order('updated_at',{ascending:true}).then(({data})=>{ const m={}; (data||[]).forEach(r=>{ if(r.key&&r.value) m[r.key]=r.value }); setNotaProyL(m) },()=>{}) },[notaria])
  const aprVenta = useAprendidosVenta()   // lo aprendido gasto→trabajo (regla única sugerirVentaGasto)
  const [notaAlias,setNotaAlias] = useState([])   // learnings kind 'notaria_alias': key (requirente/frase) → value (client_id)
  useEffect(()=>{ if(!notaria||DEMO) return; supabase.from('learnings').select('key,value').eq('kind','notaria_alias').order('updated_at',{ascending:true}).then(({data})=>setNotaAlias(data||[]),()=>{}) },[notaria])
  // Glosas aprendidas por tipo de trámite (materia normalizada → glosa a rendir). Se aprende al editar una glosa en el preview.
  const glosaLearnedRef = useRef({})
  useEffect(()=>{ if(!notaria||DEMO) return; supabase.from('learnings').select('key,value').eq('kind','notaria_glosa').order('updated_at',{ascending:true}).then(({data})=>{ const m={}; (data||[]).forEach(r=>{ if(r.key&&r.value) m[r.key]=r.value }); glosaLearnedRef.current=m },()=>{}) },[notaria])
  const notaIdx = useMemo(()=>{ const idx=[]
    clients.forEach(c=>{ if(c.status==='Terminado') return; const t=_toksNota(c.name); if(t.length) idx.push({cid:c.id,t}) })
    ;(clientEntities||[]).forEach(e=>{ if(e.name&&e.client_id){ const t=_toksNota(e.name); if(t.length) idx.push({cid:e.client_id,t}) } })
    ;(sales||[]).forEach(s=>{ if(s.title&&s.client_id&&!s.deleted_at){ const t=_toksNota(s.title); if(t.length) idx.push({cid:s.client_id,t}) } })
    ;(billing||[]).forEach(f=>{ if(f.receptor_name&&f.client_id){ const t=_toksNota(f.receptor_name); if(t.length) idx.push({cid:f.client_id,t}) } })
    ;(notaAlias||[]).forEach(a=>{ if(a.key&&a.value){ const t=_toksNota(a.key); if(t.length) idx.push({cid:a.value,t}) } })
    return idx
  },[clients,clientEntities,sales,billing,notaAlias])
  const notaSugerir = r => {
    const rt=_toksNota(`${r.requirente||''} ${r.materia||''} ${r.concepto||''} ${r.subconcepto||''}`); if(!rt.length) return null
    const hits=new Map()
    notaIdx.forEach(e=>{ const inter=e.t.filter(t=>rt.includes(t)); if(inter.length){ const s=hits.get(e.cid)||new Set(); inter.forEach(x=>s.add(x)); hits.set(e.cid,s) } })
    if(hits.size!==1) return null   // ambiguo o sin match → no adivina (queda sin cliente para que lo asignes)
    const [cid,toks]=[...hits.entries()][0]
    const c=clients.find(x=>String(x.id)===String(cid)); if(!c) return null
    return { id:cid, name:c.name, why:[...toks].slice(0,3) }
  }
  // Aprende: requirente → cliente (learning notaria_alias), para que la próxima OT de ese requirente venga sugerida.
  const learnNota = async (row, clientId) => {
    const key=String(row?.requirente||'').trim(); if(sinNombreReal(key)||!clientId||DEMO) return
    try{ await supabase.from('learnings').insert({kind:'notaria_alias',key,value:String(clientId)}); setNotaAlias(p=>[...p,{key,value:String(clientId)}]) }catch(_){}
  }

  // Nivel 4: lote a Claude (Opus) para nombres sin resolver + corrección de conceptos.
  const aiMatchBatch = async(batch) => {
    const clientesDB = clients.map(c=>`- ID: ${c.id} | Nombre: "${c.name}" | RUT: ${c.rut||'-'} | RS: "${c.razon_social||''}"`).join('\n')
    const lista = batch.map((r,i)=>`${i+1}. "${r.nombre||r.rut||''}" | concepto: "${r.concepto||''}"${r.subconcepto?` | subconcepto: "${r.subconcepto}"`:''}${r.ot?` | OT: "${r.ot}"`:''}${r.notas?` | notas: "${r.notas}"`:''}`).join('\n')
    const prompt = `Eres un asistente experto para una firma de abogados chilena. Debes hacer match entre nombres de una planilla histórica y clientes del sistema. Los nombres pueden estar abreviados, sin sufijos legales, con errores de tipeo o con distintas capitalizaciones.

CLIENTES REGISTRADOS EN EL SISTEMA:
${clientesDB}

NOMBRES A RESOLVER (con su concepto):
${lista}

El campo cliente de la planilla puede contener indistintamente: el nombre del cliente, la razón social, una mezcla o abreviación, solo apellido o nombre parcial, o el nombre de fantasía/proyecto. Compara contra AMBOS campos (nombre Y razón social) de cada cliente. La notaría envía datos desordenados: USA TAMBIÉN el subconcepto, el OT y las notas como pistas para identificar al cliente (suelen mencionar el proyecto, la operación o el nombre del cliente). "Oficina", "Liberona Escala", "interno" → gasto interno de la firma (sin cliente externo, is_internal=true).

TAREA 2 — compón la GLOSA del gasto en "concepto_corregido": combina el concepto con el subconcepto en una sola frase clara y legible para el cliente (ej. concepto "Escritura pública" + subconcepto "compraventa lote 4 chicureo" → "Escritura pública — Compraventa lote 4, Chicureo"). Corrige ortografía/tildes/capitalización y expande abreviaciones legales chilenas ("EP"→"Escritura Pública", "CV"→"Compraventa", "CCV"→"Copia con Vigencia", "GP"→"Gravámenes y Prohibiciones", "D.O."→"Diario Oficial", "+K"→"Empresa en un Día", "CBRS"→"CBR Santiago"). NO incluyas el OT en la glosa (va aparte). Si no hay subconcepto, solo corrige el concepto.

Responde SOLO con un array JSON sin markdown ni texto adicional:
[{"index":1,"raw_nombre":"...","client_id":"uuid o null","client_nombre":"... o null","confidence":0-100,"reason":"breve","is_internal":true/false,"concepto_corregido":"..."}]`
    try{
      const data = await claudeCall({model:'claude-opus-4-8',max_tokens:8000,messages:[{role:'user',content:prompt}]})
      const raw = (data.content?.[0]?.text||'[]').replace(/^```(?:json)?\s*/i,'').replace(/```\s*$/,'').trim()
      let arr
      try{ arr = JSON.parse(raw) }
      catch(_){ const cut = raw.lastIndexOf('}'); try{ arr = cut>0 ? JSON.parse(raw.slice(0,cut+1)+']') : [] }catch(__){ arr = [] } }  // respuesta truncada → recupera objetos completos
      return Array.isArray(arr) ? arr : []
    }catch(e){ return [] }
  }

  // Orquesta: fuzzy sync + IA en lotes. Enriquardo cada fila con confidence/method/suggestion/candidates/concepto.
  const runMatching = async(baseRows) => {
    setMatching(true)
    const yield0 = () => new Promise(r=>setTimeout(r,0))
    try{
      const rows = baseRows.map(r=>({...r}))
      await yield0()   // deja que la tabla se pinte antes del trabajo pesado
      // Fuzzy en bloques, cediendo el hilo cada 20 filas para no congelar Safari.
      for(let i=0;i<rows.length;i++){
        const r = rows[i]
        if(r.client_id || r.personal_de) continue
        if(!r.rut && !r.nombre){
          const ns = notaria ? notaSugerir(r) : null
          if(ns){ r.suggestion={id:ns.id,name:ns.name}; r.confidence=88; r.matchMethod='notaria'; r.notaWhy=ns.why }
          else { r.matchMethod='none'; r.confidence=0 }
          continue
        }
        const cs = candidatos(r.nombre||r.rut)
        const top = cs[0]
        if(top && top.score>=90){ const ents=entsOf(top.c.id); r.client_id=top.c.id; r.clientName=top.c.name; r.entity_id=ents.length===1?ents[0].id:null; r.matchMethod='name_fuzzy'; r.confidence=top.score }
        else if(top && top.score>=70){ r.suggestion={id:top.c.id,name:top.c.name}; r.confidence=top.score; r.matchMethod='name_fuzzy' }
        else if(top && top.score>=50){ r.candidates=cs.slice(0,3).map(s=>({id:s.c.id,name:s.c.name,score:s.score})); r.confidence=top.score; r.matchMethod='name_fuzzy' }
        else { r._needsAI=true }
        if(i%20===19){ setRows(rows.map(x=>({...x}))); await yield0() }
      }
      setRows(rows.map(r=>({...r})))
      // IA: compone/limpia la GLOSA de TODAS las filas (uniformidad) y resuelve el cliente solo de las que siguen sin asignar.
      const aiRows = rows.filter(r=> r.concepto || r.subconcepto)
      if(aiRows.length){
        const lotes=[]; for(let i=0;i<aiRows.length;i+=20) lotes.push(aiRows.slice(i,i+20))
        setMatchProg({done:0,total:lotes.length})
        for(let li=0; li<lotes.length; li++){
          const lote = lotes[li]
          const res = await aiMatchBatch(lote)
          res.forEach(o=>{
            const r = lote[(o.index||0)-1]; if(!r) return
            const conf = Number(o.confidence)||0
            if(o.concepto_corregido && o.concepto_corregido.trim() && o.concepto_corregido.trim()!==r.concepto){ r.conceptoOrig=r.concepto; r.concepto=o.concepto_corregido.trim(); r.conceptoFix=true }
            if(r.matchMethod==='notaria' && r.suggestion) return   // ya sugerido por el identificador de notaría (determinista): la IA solo aporta la glosa
            if(r.client_id || r.personal_de) return   // fila ya resuelta: de la IA solo se toma la glosa, no se re-asigna cliente
            if(o.is_internal){ r.isInternal=true; r.matchMethod='ai'; r.confidence=conf; r.aiReason=o.reason||null; return }
            if(o.client_id && conf>=85){ const c=clients.find(c=>String(c.id)===String(o.client_id)); if(c){ const ents=entsOf(c.id); r.client_id=c.id; r.clientName=c.name; r.entity_id=ents.length===1?ents[0].id:null; r.matchMethod='ai'; r.confidence=conf; r.aiReason=o.reason||null } }
            else if(o.client_id && conf>=65){ const c=clients.find(c=>String(c.id)===String(o.client_id)); if(c){ r.suggestion={id:c.id,name:c.name}; r.confidence=conf; r.matchMethod='ai'; r.aiReason=o.reason||null } }
            else { r.matchMethod='none'; r.confidence=conf; r.aiReason=o.reason||null }
          })
          setRows(rows.map(r=>({...r})))
          setMatchProg({done:li+1,total:lotes.length})
        }
      }
      setRows(rows.map(r=>({...r})))
    }catch(e){ console.error('matching',e) }
    finally{ setMatching(false); setMatchProg(null)
      if(notaria){ try{ const c=notaCats(rows); const nD=c.listas.length+c.proyecto.length+c.oficina.length+c.personal.length; const nR=c.falta.length+c.confirma.length; flash(`Análisis listo · ${nD} para cargar${nR?` · ${nR} por revisar`:''}`); setReadyBanner(true) }catch(_){ flash('Análisis listo · revisa la carga') ; setReadyBanner(true) } }
    }
  }

  // Fecha tolerante: Date nativo, serial Excel, dd.mm.yy(yy), dd-mm-yyyy, dd/mm/yyyy, yyyy-mm-dd. Vacío → ''.
  const parseFecha = v => {
    if(v===null||v===undefined||v==='') return ''
    if(v instanceof Date && !isNaN(v)) return v.toISOString().slice(0,10)
    // Número serial de Excel (días desde 1899-12-30). Se acepta como número o string puramente numérico.
    if(typeof v==='number' || /^\d{3,6}$/.test(String(v).trim())){
      const n = Number(v)
      if(n>20000 && n<80000){ const d=new Date(Date.UTC(1899,11,30)+n*86400000); if(!isNaN(d)) return d.toISOString().slice(0,10) }
    }
    const str = String(v).trim()
    // dd[.-/]mm[.-/]yy(yy)
    const m = str.match(/^(\d{1,2})[.\-/](\d{1,2})[.\-/](\d{2,4})$/)
    if(m){ let y=m[3]; if(y.length===2) y='20'+y; return `${y}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}` }
    if(/^\d{4}-\d{2}-\d{2}/.test(str)) return str.slice(0,10)
    return ''   // formato no reconocido → null (no bloquea; Commit 4 importa igual)
  }

  // Monto tolerante: separadores de miles (1.234.567), símbolo $, espacios. Vacío/no numérico → null.
  const parseMonto = v => {
    if(v===null||v===undefined||v==='') return null
    if(typeof v==='number') return Math.round(v)
    const limpio = String(v).replace(/[^\d-]/g,'')   // quita $, puntos de miles, espacios
    if(limpio===''||limpio==='-') return null
    const n = parseInt(limpio,10)
    return isNaN(n) ? null : n
  }

  // Miembros de la oficina: un gasto "Personal · Martín" / "Personal: Martín" en la columna Cliente
  // se enruta a personal_de (no es cliente). Convención para la carga masiva de notaría.
  const MIEMBROS_NOTA = ['Cristóbal','Erasmo','Martín','Martina','Rodrigo']

  // Sinónimos de columna (lowercased). El parser reconoce cualquiera de estos encabezados, en cualquier orden.
  const COLALIAS = {
    cliente:   ['cliente','nombre','nombre cliente','razón social','razon social','client'],
    rut:       ['rut','rut cliente'],
    abogado:   ['abogado','responsable','abogado responsable'],
    fecha:     ['fecha','fecha gasto','date'],
    concepto:  ['concepto','actividad','descripción','descripcion','detalle','glosa','detail'],
    detalle:   ['detalle proveedor','detalle prov','proveedor detalle'],
    subconcepto:['subconcepto','sub concepto','sub-concepto','subconc','detalle adicional','sub detalle','subglosa','sub glosa'],
    ot:        ['ot','o.t.','orden','orden de trabajo','n° ot','nro ot','ot n°','numero ot','número ot','n ot'],
    categoria: ['categoría','categoria','tipo','proveedor','category'],
    monto:     ['monto','importe','valor','amount','total','derecho','derechos','saldo','saldo a pagar','arancel','aranceles','derecho notarial'],
    notas:     ['notas','nota','observaciones','observación','observacion','comments'],
    proyecto:  ['proyecto','propuesta','propuesta - proyecto','project'],
    requirente:['requirente','solicitante','requerido por','requiere','requirente/interesado','interesado','rogante','peticionario','compareciente','comparecientes','partes'],
    materia:   ['materia','asunto','acto','tipo de acto','naturaleza','naturaleza del acto','tramite','trámite'],
    caja_chica:['caja chica','pagado caja chica','pagado con caja chica','con cargo a caja chica','cargo caja chica','pagado con cargo a caja chica','pagada caja chica','caja chica (si/no)','caja chica si/no','¿caja chica?'],
  }
  // Mapea un valor de categoría de la planilla a una categoría válida del sistema (mantiene Registro Civil).
  const CAT_SINONIMOS = {
    'notaria':'Notaria','notaría':'Notaria','notario':'Notaria',
    'cbr':'CBR','conservador':'CBR','conservador de bienes raices':'CBR','conservador de bienes raíces':'CBR',
    'diario oficial':'Diario Oficial','d.o.':'Diario Oficial','do':'Diario Oficial',
    'registro civil':'Registro Civil','r. civil':'Registro Civil','rcivil':'Registro Civil',
  }
  const mapCategoria = raw => {
    const k = catNorm(raw)
    if(!k) return 'Otro'
    if(CAT_SINONIMOS[k]) return CAT_SINONIMOS[k]
    return CAT_OPCIONES.find(c=>catNorm(c)===k) || 'Otro'
  }

  // ── Notaría: el export real trae Compareciente (partes con RUT), Materia y Observación; el cliente NO viene dado ──
  // Parsea el Compareciente en partes {nombre, rut} (separadas por saltos de línea / _x000D_).
  const parseComparecientes = (txt) => String(txt||'').replace(/_x000D_/g,'\n').replace(/\r/g,'\n').split('\n').map(s=>s.trim()).filter(Boolean).map(p=>{
    const m = p.match(/(\d{1,2}\.?\d{3}\.?\d{3}\s*-\s*[\dkK]|0\s*-\s*0)/)
    const rut = m ? m[1].replace(/\s/g,'') : ''
    const nombre = (m ? p.slice(0,m.index) : p).trim()
    return { nombre, rut: rut==='0-0'?'':rut }
  }).filter(x=>x.nombre||x.rut)
  // ¿Es la propia firma o uno de nuestros abogados/apoderados? (no es el cliente del trámite)
  const esFirmaOLawyer = n => { const s=catNorm(n).replace(/\s/g,''); if(!s) return true; return /liberonaescala|escalamarcet|camperomantelli|liberonapena|erasmoignacioescala|martincampero/.test(s) }
  // Glosa a rendir al cliente, armada desde Materia (+ detalle de Observación cuando aporta). La IA la pule y es editable.
  const _ACENTOS_NOTA = {modificacion:'modificación',constitucion:'constitución',reduccion:'reducción',autorizacion:'autorización',protocolizacion:'protocolización',fusion:'fusión',division:'división',cesion:'cesión',delegacion:'delegación',declaracion:'declaración',cancelacion:'cancelación',transformacion:'transformación',prorroga:'prórroga',credito:'crédito',creditos:'créditos',publica:'pública',juridica:'jurídica',compania:'compañía',deposito:'depósito',inscripcion:'inscripción',complementacion:'complementación',manifestacion:'manifestación',accionistas:'accionistas',devolucion:'devolución',prestacion:'prestación',captacion:'captación',subordinacion:'subordinación'}
  const glosaNotaria = (materia, obs) => {
    const mk = catNorm(materia); if(mk && glosaLearnedRef.current[mk]) return glosaLearnedRef.current[mk]   // glosa aprendida para este trámite
    let m = String(materia||'').trim().toLowerCase(); if(!m) return 'Gastos notariales'
    m = m.replace(/[a-záéíóúñ]+/g, w=>_ACENTOS_NOTA[w]||w)   // tildes en los términos frecuentes (el archivo viene en MAYÚSCULAS sin acentos)
    m = m.charAt(0).toUpperCase()+m.slice(1)
    let g = 'Gastos notariales — ' + m
    const o = String(obs||'').trim()
    if(o && !/sin efecto/i.test(o) && o.length<=60 && !/\bspa\b|s\.a\.|limitada|ltda/i.test(o)) g += ' ('+o.toLowerCase()+')'
    return g
  }

  // La herramienta aprende el RUT: al asignar un compareciente a un cliente, guarda su razón social + RUT como client_entity
  // (si trae RUT y no existe ya) → la próxima carga de notaría matchea ese RUT solo, sin trabajo manual.
  const learnRutNota = async (row, clientId) => {
    if(!notaria || DEMO || !clientId || !row) return
    const parties = parseComparecientes(row.requirente).filter(p=>p.rut && !esFirmaOLawyer(p.nombre))
    if(!parties.length) return
    const pick = parties.find(p=>catNorm(p.nombre)===catNorm(row.nombre)) || (parties.length===1 ? parties[0] : null)
    if(!pick) return
    const nr = normRut(pick.rut); if(!nr) return
    if((clientEntities||[]).some(e=>normRut(e.rut)===nr)) return   // ese RUT ya está cargado → no duplicar (regla anti-duplicados)
    try{ await supabase.from('client_entities').insert({client_id:clientId, name:pick.nombre, rut:pick.rut}); onClientsUpdate&&onClientsUpdate() }catch(_){}
  }
  // Abogado de la notaría → miembro del estudio (para el responsable del cliente).
  const abogadoNotaMap = raw => { const s=catNorm(raw).replace(/\s/g,''); if(!s||s==='ninguno'||s==='total') return null; if(s.includes('escalamarcet')||s.includes('erasmo')) return 'Erasmo'; if(s.includes('campero')||s.includes('martin')) return 'Martín'; if(s.includes('liberonapena')||s.includes('cristobal')) return 'Cristóbal'; return null }
  // Si el cliente aún no tiene abogado responsable, lo fija con el Abogado que trae el archivo de notaría (no pisa uno existente).
  const setRespNota = async (row, clientId) => {
    if(!notaria || DEMO || !clientId || !row?.abogadoResp) return
    const c = clients.find(x=>String(x.id)===String(clientId)); if(!c || (c.abogado_responsable||'').trim()) return
    try{ await supabase.from('clients').update({abogado_responsable:row.abogadoResp}).eq('id',clientId); onClientsUpdate&&onClientsUpdate() }catch(_){}
  }

  // Buscar en Drive: busca el compareciente en los documentos y SUBE por las carpetas hasta una cuyo nombre sea un cliente.
  // Devuelve {client, folder} o null. Reusa la mecánica validada: carpeta del cliente = nombre del cliente en la app.
  const driveFindClient = async (nombre) => {
    const nm = String(nombre||'').replace(/['\\]/g,' ').trim(); if(nm.length<4) return null
    let files=[]
    // Busca por CONTENIDO y por NOMBRE de archivo (la carpeta del cliente suele tener la razón social en el título del doc).
    try{ const d=await driveCall({action:'search', q:`(fullText contains '${nm}' or name contains '${nm}') and trashed=false`, pageSize:15}); files=d.files||[] }
    catch(e){ return {error:e.message} }
    if(!files.length) return null
    const cnorm = s => normName(s)
    const byFolder = new Map()
    clients.forEach(c=>{ [c.name, c.razon_social, ...entsOf(c.id).map(e=>e.name)].filter(Boolean).forEach(v=>{ const k=cnorm(v); if(k&&!byFolder.has(k)) byFolder.set(k,c) }) })
    const cache={}; const metaOf = async id => { if(id in cache) return cache[id]; try{ cache[id]=await driveCall({action:'meta', fileId:id}) }catch(_){ cache[id]=null } return cache[id] }
    for(const f of files){
      let parents=f.parents||[]; let depth=0; const seen=new Set()
      while(parents.length && depth<6){ const pid=parents[0]; if(seen.has(pid)) break; seen.add(pid); const m=await metaOf(pid); if(!m) break; const hit=byFolder.get(cnorm(m.name)); if(hit) return {client:hit, folder:m.name}; parents=m.parents||[]; depth++ }
    }
    return null
  }
  // Drive PROPONE (compuerta): guarda el cliente encontrado como SUGERENCIA (no asigna solo) → la fila pasa a
  // "Confirma el cliente" para que el humano confirme. Coherente con "gate → aprende → se libera".
  const driveSuggest = (rowId, res) => { setRows(p=>p.map(r=> r.id===rowId ? {...r, suggestion:{id:res.client.id, name:res.client.name}, confidence:100, driveFolder:res.folder, suggestFrom:'drive'} : r)); setTouched(true) }
  // Busca en Drive el cliente de TODAS las OT sin cliente, en secuencia (con contador). Propone, no asigna.
  const buscarTodasDrive = async () => {
    const pend = (rows||[]).filter(r=> !r.client_id && !r.personal_de && !r.isInternal && !r.error && !r.suggestion && String(r.nombre||r.requirente||'').trim().length>=4)
    if(!pend.length) return
    setDriveAll({done:0,total:pend.length})
    for(let i=0;i<pend.length;i++){
      const r=pend[i]
      try{ const res=await driveFindClient(r.nombre||r.requirente); if(res&&res.client){ driveSuggest(r.id,res); setDriveMsg(m=>({...m,[r.id]:`✓ Drive: ${res.client.name}`})) } else setDriveMsg(m=>({...m,[r.id]: res&&res.error?('Error: '+res.error):'No lo encontré en Drive'})) }catch(_){}
      setDriveAll({done:i+1,total:pend.length})
    }
    setDriveAll(null)
  }

  const onFile = async(e) => {
    const file = e.target.files?.[0]; if(!file) return
    setFileName(file.name)
    setCargando(true)
    try{
      const XLSX = await import('https://cdn.sheetjs.com/xlsx-0.20.1/package/xlsx.mjs')
      const buf = await file.arrayBuffer()
      const wb = XLSX.read(buf,{type:'array',cellDates:true})
      // Hoja según el tipo elegido (Gastos/Fondos); si no existe esa hoja, la primera
      const target = tipo==='fondo' ? 'fondos' : 'gastos'
      const sheetName = wb.SheetNames.find(n=>n.toLowerCase().trim()===target) || wb.SheetNames[0]
      const norm = s => String(s??'').toLowerCase().trim()
      // Construye una fila a partir de un getter de campo (sirve para la vía por objeto y la de matriz).
      const buildRow = (getField,idx,allVals) => {
        const rut = String(getField('rut')||'').trim()
        const nombre = String(getField('cliente')||'').trim()
        const cBase = String(getField('concepto')||'').trim()
        const cDet  = String(getField('detalle')||'').trim()
        const concepto = cBase&&cDet ? `${cBase} — ${cDet}` : (cBase||cDet)
        const subconcepto = String(getField('subconcepto')||'').trim()   // detalle que distingue gastos con igual concepto (notaría)
        let ot = String(getField('ot')||'').trim()                       // N° de orden de la notaría (OT-XXXX)
        // Segunda lectura (no re-subir el archivo): si la columna OT no calzó en una fila de notaría, releer la MISMA fila
        // buscando una OT con prefijo explícito ("OT-12345", "O.T 12345"). Es conservador: NO agarra el Repertorio (número pelado).
        if(notaria && (!ot || !/\d/.test(ot)) && Array.isArray(allVals)){
          for(const v of allVals){ const m=String(v??'').match(/\bO\.?\s*T\.?\s*(?:n°|nro|no|#)?\s*[:\-–]?\s*(\d{3,})\b/i); if(m){ ot=m[1]; break } }
        }
        const notas = String(getField('notas')||'').trim()
        const proyecto = String(getField('proyecto')||'').trim()
        const requirente = String(getField('requirente')||'').trim()   // quién pidió el trámite (señal para identificar cliente)
        const materia = String(getField('materia')||'').trim()          // tipo de acto/asunto (señal + detalle del documento)
        const fecha = parseFecha(getField('fecha'))
        const monto = parseMonto(getField('monto'))
        const cajaRaw = norm(getField('caja_chica'))   // "sí"=pagado con caja chica (paid_by_client=false); "no"=sin caja chica (true)
        const paidByClient = cajaRaw==='' ? undefined : /^(no|false|n|0|nro|na)$/.test(cajaRaw)
        if(!rut&&!nombre&&!concepto&&monto==null&&!fecha&&!notas) return null  // fila vacía
        const _rawCat=String(getField('categoria')||'').trim()
        const _learnCat=(!_rawCat&&concepto)?catLearnRef.current[glosaKey(concepto)]:null   // sin categoría en la planilla → usa la aprendida (tú la revisas en el preview)
        const categoria = tipo==='fondo' ? 'Fondo' : (notaria && !_rawCat ? 'Notaria' : (_rawCat ? mapCategoria(_rawCat) : (_learnCat&&CAT_OPCIONES.includes(_learnCat) ? _learnCat : 'Otro')))
        // Gasto personal de un miembro de la oficina: "Personal · Martín" / "Personal: Martín" → personal_de (no es cliente).
        const _pm = nombre.match(/^\s*personal\s*[·:.\-]\s*(.+)$/i)
        let personalDe = null
        if(_pm){ const cand=catNorm(_pm[1]); personalDe = MIEMBROS_NOTA.find(p=>catNorm(p)===cand) || _pm[1].trim() }
        let nombreEff=nombre, conceptoEff=concepto, cli=null, method, entId
        const abogadoResp = notaria ? abogadoNotaMap(getField('abogado')) : null   // responsable que trae el archivo
        if(notaria){
          // El cliente NO viene dado (col 'Cliente' = la firma). Se deduce del Compareciente: RUT primero, luego nombre, luego alias aprendido.
          conceptoEff = glosaNotaria(materia, notas)
          const parties = parseComparecientes(requirente)
          for(const pt of parties){ if(!pt.rut||esFirmaOLawyer(pt.nombre)) continue; const ex=exactMatch(pt.rut,''); if(ex.client){ cli=ex.client; method='rut_exact'; entId=ex.entity_id; nombreEff=pt.nombre||nombreEff; break }
            const bcid=rutBillingMap.get(normRut(pt.rut)); if(bcid){ const c=clients.find(x=>String(x.id)===String(bcid)); if(c){ cli=c; method='rut_factura'; entId=null; nombreEff=pt.nombre||nombreEff; break } } }
          if(!cli) for(const pt of parties){ if(esFirmaOLawyer(pt.nombre)) continue; const ex=exactMatch('',pt.nombre); if(ex.client){ cli=ex.client; method='name_exact'; entId=ex.entity_id; nombreEff=pt.nombre; break } const al=aliasClient(pt.nombre); if(al){ cli=al; method='aprendido'; entId=null; nombreEff=pt.nombre; break } }
          if(!nombreEff||/^liberona escala|^n\/a$/i.test(nombreEff.trim())) nombreEff = (parties.find(p=>!esFirmaOLawyer(p.nombre))?.nombre) || parties[0]?.nombre || ''
        } else {
          const ex = personalDe ? {client:null,method:'personal',entity_id:null} : exactMatch(rut,nombre)
          cli=ex.client; method=ex.method; entId=ex.entity_id
          if(!cli&&!personalDe){ const al=aliasClient(nombre); if(al){ cli=al; method='aprendido'; entId=null } }   // memoria aprendida
        }
        const ents=cli?entsOf(cli.id):[]
        let error=null
        // REGLA: un gasto de notaría SIEMPRE trae su OT (la OT es la fuente de la verdad). Si una fila tiene compareciente/monto pero NO se
        // extrajo OT, es un ERROR (no se carga sin OT: se marca para que revises la columna). Solo la fila "Total" (sin OT NI compareciente) se ignora.
        if(notaria && (!ot || !/\d/.test(ot))){ if(!cli && !(nombreEff&&nombreEff.trim())) return null; error='OT no detectada · revisa la columna OT del archivo (todo trabajo de notaría trae OT)' }
        if(!error){ if(monto==null) error='Monto vacío o inválido'
        else if(monto<0) error='Monto negativo no permitido'
        else if(monto===0&&!notaria) error='Monto debe ser mayor a 0'
        else if(notaria && monto===0) error = /sin efecto/i.test(notas) ? 'Sin efecto (anulada)' : 'Sin cobro ($0) · la notaría no la cobra'   // la notaría deja en $0 lo que ya no cobra
        else if(notaria && (monto<=1)) error = /sin efecto/i.test(notas) ? 'Sin efecto (anulada)' : 'De registro ($1) · no se cobra' }   // OT de $1 = solo registro de la notaría (anulada o protocolización sin costo): no es gasto ni se cobra. Las "sin efecto" con cobro real (>$1) sí son facturables a su cliente (no error).
        return {id:idx, rut, nombre:nombreEff, fecha, monto, concepto:conceptoEff, subconcepto, ot, notas, proyecto, requirente, materia, categoria, abogadoResp, paid_by_client:paidByClient, client_id:cli?.id||null, clientName:cli?.name||null, personal_de:personalDe||null, entity_id: entId || (ents.length===1?ents[0].id:null), matchMethod: personalDe?'personal':(cli?method:undefined), confidence: personalDe?100:(cli?(method==='rut_exact'?100:method==='name_exact'?95:90):undefined), error, dup:false}
      }
      // VÍA 1 (principal): por objeto, encabezado en la primera fila, columnas por alias. Robusta.
      let parsed = []
      const objs = XLSX.utils.sheet_to_json(wb.Sheets[sheetName],{defval:''})
      objs.forEach(o=>{
        const getField = field => { const aliases=COLALIAS[field]||[]; for(const k of Object.keys(o)){ if(aliases.includes(norm(k))) return o[k] }
          // Match flexible para la columna OT: encabezados como "N° OT", "OT (orden de trabajo)" no calzan exacto → reconocer "ot" como token o "orden".
          if(field==='ot'){ for(const k of Object.keys(o)){ const nk=norm(k); if((/(^|[^a-z])ot([^a-z]|$)/.test(nk)||nk.includes('orden')) && o[k]!=='' && o[k]!=null) return o[k] } }
          return '' }
        const r = buildRow(getField, parsed.length, Object.values(o)); if(r) parsed.push(r)
      })
      // VÍA 2 (respaldo): si la vía 1 no obtuvo filas, leer como matriz y detectar encabezado en las 5 primeras filas.
      if(parsed.length===0){
        const aoa = XLSX.utils.sheet_to_json(wb.Sheets[sheetName],{header:1,defval:'',raw:true})
        const aliasFlat = Object.values(COLALIAS).flat()
        let hIdx=-1, best=0
        for(let i=0;i<Math.min(5,aoa.length);i++){ const score=(aoa[i]||[]).filter(c=>aliasFlat.includes(norm(c))).length; if(score>best){best=score;hIdx=i} }
        const colMap={}
        ;(hIdx>=0?aoa[hIdx]:(aoa[0]||[])).forEach((cell,idx)=>{ const n=norm(cell); for(const [field,aliases] of Object.entries(COLALIAS)){ if(aliases.includes(n)&&colMap[field]===undefined) colMap[field]=idx } })
        let startRow=(hIdx>=0?hIdx:0)+1
        if(!['cliente','rut','monto'].some(f=>colMap[f]!==undefined)){ Object.assign(colMap,{cliente:0,fecha:1,concepto:2,categoria:3,monto:4}); startRow=0 }
        aoa.slice(startRow).forEach(row=>{
          if(!Array.isArray(row)) return
          const getField = field => colMap[field]!==undefined ? row[colMap[field]] : ''
          const r = buildRow(getField, parsed.length, row); if(r) parsed.push(r)
        })
      }
      if(parsed.length===0){ appAlert('No se encontraron filas. Revisa que el Excel tenga una columna de Cliente (o RUT) y otra de Monto. Puedes descargar la plantilla modelo como referencia.'); setRows(null); setCargando(false); return }
      // Detección de duplicados dentro del archivo (mismo RUT + fecha + monto + concepto). No bloquea, solo avisa.
      const keyOf = r => `${normRut(r.rut)}|${r.fecha}|${r.monto}|${(r.concepto||'').trim().toLowerCase()}|${(r.subconcepto||'').trim().toLowerCase()}|${(r.ot||'').trim().toLowerCase()}`
      const counts={}
      parsed.forEach(r=>{ const k=keyOf(r); counts[k]=(counts[k]||0)+1 })
      parsed.forEach(r=>{ if(counts[keyOf(r)]>1) r.dup=true })
      setRows(parsed)
      // Retomar decisiones del lote (reasignaciones / forzar nuevo) guardadas para el mismo archivo.
      if(modo==='conciliar'){ try{ const saved=JSON.parse(localStorage.getItem('carga_dec_v1')||'{}'); const mm={}; const ff=new Set(); const pd={}; parsed.forEach(r=>{ const k=rowKeyHuella(r); if(saved.match&&saved.match[k]) mm[r.id]=saved.match[k]; if(Array.isArray(saved.forzar)&&saved.forzar.includes(k)) ff.add(r.id); if(saved.posdec&&saved.posdec[k]) pd[r.id]=saved.posdec[k] }); if(Object.keys(mm).length) setConcilMatch(mm); if(ff.size) setForzarNuevo(ff); if(Object.keys(pd).length) setPosibleDec(pd) }catch(_){} }
      setCargando(false)
      runMatching(parsed)   // enriquece con fuzzy + IA (async, vuelve a setRows)
      return
    }catch(err){ appAlert('Error al leer el Excel: '+err.message) }
    setCargando(false)
  }

  // Identidad cruda de la fila para propagar: RUT si hay, si no el nombre normalizado.
  const rawKey = r => normRut(r.rut) || (sinNombreReal(r.nombre) ? '' : String(r.nombre||'').toLowerCase().trim())
  // Asignar cliente a una fila Y a todas las filas iguales (mismo RUT/nombre) que aún no haya
  // resuelto el usuario manualmente — así no se repite el trabajo.
  const asignar = (rowId,clientId,method) => {
    const c = clients.find(x=>x.id===clientId)
    const ents = entsOf(clientId)
    let srcNombre=null, srcRow=null
    setRows(p=>{
      const src = p.find(r=>r.id===rowId)
      srcNombre = src?.nombre || null; srcRow = src || null
      const key = src ? rawKey(src) : null
      // método: 'drive' si venía de una sugerencia de Drive (cuenta como reconocida sola), si no 'manual'
      const apply = r => ({...r,client_id:clientId,clientName:c?.name||null,entity_id:ents.length===1?ents[0].id:null,suggestion:null,candidates:null,isInternal:false,personal_de:null,matchMethod: method || (r.suggestFrom==='drive'?'drive':'manual'), suggestFrom:null, driveFolder:null})
      return p.map(r=>{
        if(r.id===rowId) return apply(r)
        if(key && rawKey(r)===key && r.matchMethod!=='manual') return apply(r)  // iguales aún no fijados a mano
        return r
      })
    })
    // Aprende: este nombre crudo → este cliente, para que las próximas cargas caigan solas.
    if(onLearnAlias && srcNombre && !sinNombreReal(srcNombre)) onLearnAlias(String(srcNombre).toLowerCase().trim(), clientId)
    if(srcRow && String(srcRow.requirente||'').trim()){ learnNota(srcRow, clientId); learnRutNota(srcRow, clientId); setRespNota(srcRow, clientId)   // notaría: aprende requirente→cliente, RUT→client_entity y fija responsable
      const nm=srcRow.nombre||srcRow.requirente; setAprendido({name:nm,cli:c?.name||''}); setTimeout(()=>setAprendido(a=>(a&&a.name===nm)?{}:a),4500); setAprendidasSet(s=>new Set(s).add(rowId)) }   // micro-aviso: "lo aprendí" + cuenta para el chip del hero
    // Notaría: ¿hay OTRAS OT sin cliente con compareciente PARECIDO (no idéntico, esos ya se propagaron)? Ofrece asignarlas juntas.
    if(notaria && srcRow && !sinNombreReal(srcNombre)){
      const kSrc=rawKey(srcRow)
      const sim=(rows||[]).filter(r=> r.id!==rowId && !r.client_id && !r.personal_de && !r.error && !sinNombreReal(r.nombre) && rawKey(r)!==kSrc && (()=>{ const s=simil(srcNombre,r.nombre); return s>=80 && s<100 })())
      setSimilarPrompt(sim.length ? {clientId, clientName:c?.name||'', ids:sim.map(r=>r.id), srcName:srcNombre} : null)
    }
    flash(`Asignado a ${c?.name||'cliente'} · se guarda al Cargar`)
  }
  // Confirma de una vez todas las sugerencias (fuzzy 70-89 / IA 65-84) como cliente asignado.
  const confirmarSugeridos = () => {
    (rows||[]).forEach(r=>{ if(r.suggestion && String(r.requirente||'').trim()){ learnNota(r, r.suggestion.id); learnRutNota(r, r.suggestion.id); setRespNota(r, r.suggestion.id) } })   // notaría: aprende cada requirente confirmado (+ su RUT + responsable)
    setRows(p=>p.map(r=>{
      if(!r.suggestion) return r
      const c=clients.find(x=>x.id===r.suggestion.id); const ents=entsOf(r.suggestion.id)
      return {...r,client_id:r.suggestion.id,clientName:c?.name||null,entity_id:ents.length===1?ents[0].id:null,suggestion:null,candidates:null,matchMethod:'manual'}
    }))
  }

  // Estado de cada fila para la vista previa. montoBad es ortogonal al match.
  const montoBad = r => r.monto==null || r.monto<=0
  const bucketOf = r => (r.client_id||r.isInternal||r.personal_de) ? 'auto' : (r.suggestion ? 'sug' : (r.candidates?.length ? 'rev' : 'man'))
  // Glosa final tal como se guardará: si la IA ya compuso (conceptoFix) se usa el concepto; si no, se concatena el subconcepto. Igual que el insert.
  const glosaFinal = r => { const sub=(r.subconcepto||'').trim(), base=(r.concepto||'').trim(); return (!r.conceptoFix && sub && !base.toLowerCase().includes(sub.toLowerCase())) ? `${base} — ${sub}` : base }
  // Triage en el preview: marcar una fila como personal de un miembro (sale del cliente). El cliente «oficina» o sin cliente muestra "¿De quién es?".
  const esOficinaCli = cid => { const c=clients.find(x=>String(x.id)===String(cid)); return !!c&&(c.is_internal||/liberona\s+escala/i.test(c.name||'')) }
  // REGLA: ningún gasto de cliente sin proyecto. Se resuelve solo si no hay duda (elegido, aprendido para esa sociedad, única venta
  // o única activa); si el cliente tiene varias ventas se elige en la fila; si no tiene ninguna se escribe el trabajo.
  const ventasCli = cid => (sales||[]).filter(s=>String(s.client_id)===String(cid)&&VENTA_REAL(s))
  const proyKey = r => { const k = r.entity_id || (sinNombreReal(r.nombre||r.requirente) ? '' : normName(r.nombre||r.requirente)); return r.client_id&&k ? `${r.client_id}::${k}` : null }
  const proyDe = r => {
    if(!r.client_id || r.personal_de || r.isInternal || esOficinaCli(r.client_id)) return {need:false}
    const vs=ventasCli(r.client_id)
    if(!vs.length) return {need:!String(r.proyecto||'').trim(), vs}
    if(r.sale_id && vs.some(v=>String(v.id)===String(r.sale_id))) return {need:false, sale:r.sale_id, vs}
    const k=proyKey(r), l=k&&notaProyL[k]; if(l && vs.some(v=>String(v.id)===String(l))) return {need:false, sale:l, vs}
    const ps=proyectoSeguro(r.client_id, sales, {titulo:r.proyecto}); if(ps.sale_id) return {need:false, sale:ps.sale_id, vs}
    const sug = r.noSug ? null : sugerirVentaGasto({client_id:r.client_id,entity_id:r.entity_id||null,concept:glosaFinal(r),subconcept:r.subconcepto,materia:r.materia,date:r.fecha}, vs, {aprendidos:aprVenta,hermanos:expenses}).venta
    return {need:true, vs, sug, sale:sug?sug.id:undefined}
  }
  const sinProyNota = r => { const p=proyDe(r); return p.need && !p.sug }
  // Elegir el proyecto de una OT lo aplica también a las demás OT de la misma sociedad del cliente que aún no lo tienen.
  const setProyRow = (rowId, campo, valor) => { setTouched(true); setRows(p=>{ const src=p.find(x=>x.id===rowId); const k=src&&proyKey(src)
    const extra = campo==='sale_id' ? {proyRev:true, noSug:!valor} : {proyRev:true}
    return p.map(x=> x.id===rowId || (campo==='sale_id' && valor && k && proyKey(x)===k && !x.sale_id && proyDe(x).need) ? {...x,[campo]:valor,...extra} : x) }) }
  const proyCampo = r => { const pr=proyDe(r); if(!pr.vs || pr.vs.length===1) return null
    const st={width:'100%',maxWidth:420,padding:'6px 9px',borderRadius:8,border:`1px solid ${C.border}`,fontSize:12,background:'#fff',color:C.text,outline:'none',boxSizing:'border-box'}
    if(!pr.vs.length) return <input value={r.proyecto||''} onChange={e=>setProyRow(r.id,'proyecto',e.target.value)} placeholder='Trabajo (el cliente no tiene ventas)…' aria-label='Proyecto' style={st}/>
    const ord=pr.sug?[pr.sug,...pr.vs.filter(v=>v.id!==pr.sug.id)]:pr.vs
    const val=r.sale_id||pr.sale||''
    return <span style={{display:'flex',alignItems:'center',gap:8,flexWrap:'wrap'}}><select value={val} onChange={e=>setProyRow(r.id,'sale_id',e.target.value||null)} aria-label='Proyecto' style={{...st,flex:'1 1 220px'}}>
      <option value=''>Proyecto…</option>
      {ord.map(v=><option key={v.id} value={v.id}>{v.title}{v.status!=='Activo'?` (${String(v.status).toLowerCase()})`:''}</option>)}
    </select>{!r.sale_id&&pr.sug&&String(val)===String(pr.sug.id)&&<span style={{fontSize:10,fontWeight:600,color:C.greenText}}>sugerido por la descripción</span>}</span> }
  const asignarPersonal = (rowId,persona)=>setRows(p=>p.map(r=>r.id===rowId?{...r,personal_de:persona||null,client_id:null,clientName:null,entity_id:null,suggestion:null,candidates:null,isInternal:false,matchMethod:persona?'personal':'none',confidence:persona?100:0}:r))
  // Crea un cliente ocasional con el nombre de la fila (columna Cliente), opcionalmente con responsable, y le asigna el gasto.
  const crearOcasional = async(r,responsable)=>{ const nm=(r.nombre||'').trim(); if(!nm||!onCreateOccasional) return; const c=await onCreateOccasional(nm,responsable); if(c){ setRows(p=>p.map(x=>x.id===r.id?{...x,client_id:c.id,clientName:c.name,entity_id:null,personal_de:null,suggestion:null,candidates:null,isInternal:false,matchMethod:'manual'}:x)); if(onLearnAlias) onLearnAlias(nm.toLowerCase(), c.id); flash(`Cliente nuevo «${c.name}» · se guarda al Cargar`) }  /* aprende nombre→ocasional para que no reaparezca al re-subir */ setOcasPick(null) }
  const [ocasPick,setOcasPick] = useState(null)   // id de la fila con el selector de responsable del ocasional abierto
  const [persPick,setPersPick] = useState(null)   // id de la fila con el selector "es personal de quién" abierto
  // Marca una OT como gasto PERSONAL de un miembro (reusa el campo personal_de del motor): sale de "sin cliente" y va a la categoría Personal.
  const marcarPersonalRow = (rowId, persona) => { setRows(p=>p.map(r=> r.id===rowId ? {...r, personal_de:persona, client_id:null, clientName:null, entity_id:null, suggestion:null, candidates:null, suggestFrom:null, driveFolder:null, isInternal:false, matchMethod:'personal'} : r)); setPersPick(null); flash(`Marcado como personal de ${persona} · se guarda al Cargar`) }
  // Gasto INTERNO de la oficina (lo asume la firma): lo asigna al cliente interno.
  const marcarOficinaRow = (rowId) => { const ofi=clients.find(c=>c.is_internal||/liberona\s+escala/i.test(c.name||'')); if(!ofi){ appAlert('No encuentro el cliente interno de la oficina.'); return } setRows(p=>p.map(r=> r.id===rowId ? {...r, client_id:ofi.id, clientName:ofi.name, personal_de:null, entity_id:null, suggestion:null, candidates:null, suggestFrom:null, driveFolder:null, isInternal:false, matchMethod:'oficina'} : r)); setPersPick(null); flash('Marcado como gasto de la oficina · se guarda al Cargar') }
  const quitarInternoRow = (rowId) => { setRows(p=>p.map(r=> r.id===rowId ? {...r, personal_de:null, client_id:(r.client_id&&esOficinaCli(r.client_id))?null:r.client_id, clientName:(r.client_id&&esOficinaCli(r.client_id))?null:r.clientName, matchMethod:undefined} : r)); flash('Devuelto a «Falta el cliente»') }
  // Marca una OT como "no es nuestra": la OT es correcta pero NO la paga la oficina → NO se carga (nadie la paga), solo se registra y se avisa a la notaría. Reversible.
  const marcarNoNuestra = (rowId) => { setRows(p=>p.map(r=> r.id===rowId ? {...r, noNuestra:true, client_id:null, clientName:null, entity_id:null, personal_de:null, suggestion:null, candidates:null, suggestFrom:null, driveFolder:null, isInternal:false, matchMethod:undefined} : r)); setPersPick(null); flash('Marcada como no nuestra · no se carga, se registra') }
  const reactivarRow = (rowId) => { setRows(p=>p.map(r=> r.id===rowId ? {...r, noNuestra:false} : r)); flash('Reactivada · vuelve a la revisión') }
  // Consulta a la notaría por las OT que no reconocemos (marcadas "No es nuestra"): se seleccionan y se les pide detalle.
  const NOTA_DEST_DEFAULT='sdelgado@notarialascar.cl'
  const [notaDest,setNotaDest] = useState(NOTA_DEST_DEFAULT)
  useEffect(()=>{ if(!notaria) return; supabase.from('learnings').select('value').eq('kind','notaria_email').order('updated_at',{ascending:false}).limit(1).then(({data})=>{ const v=data&&data[0]&&data[0].value; if(v) setNotaDest(v) },()=>{}) },[notaria])
  const [notaConsultaSel,setNotaConsultaSel] = useState(()=>new Set())
  const [consultando,setConsultando] = useState(false)
  const toggleConsulta = id => setNotaConsultaSel(p=>{ const n=new Set(p); n.has(id)?n.delete(id):n.add(id); return n })
  const consultarNotaria = async(selRows) => {
    const dest=String(notaDest||NOTA_DEST_DEFAULT).split(/[,;]/).map(x=>x.trim()).filter(x=>x.includes('@')&&!/@leabogados\.cl$/i.test(x)).join(', ')
    if(!dest){ appAlert('Falta el correo de la notaría.'); return }
    if(!selRows.length){ appAlert('Selecciona al menos una OT para consultar.'); return }
    if(!(await appConfirm(`Enviar a la notaría (${dest}) una consulta por ${selRows.length} OT que no reconocemos, pidiendo detalle? La oficina va en copia.`))) return
    setConsultando(true)
    try{
      const ccEstudio=BRAND.ccNotaria||undefined
      const esc=s=>String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
      const filas=selRows.map(r=>`<tr><td style="padding:5px 0;font-size:11px;color:#185FA5;font-weight:600;white-space:nowrap">${esc(otDe(r))}</td><td style="padding:5px 8px;font-size:12px;color:#3D3D3D">${esc(r.materia||r.concepto||'—')}${r.nombre||r.requirente?` <span style="color:#99ABB4">· ${esc(r.nombre||r.requirente)}</span>`:''}</td><td style="padding:5px 0;font-size:12px;text-align:right;font-weight:600;white-space:nowrap">$${(r.monto||0).toLocaleString('es-CL')}</td></tr>`).join('')
      const html=`<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body style="font-family:Arial,Helvetica,sans-serif;background:#f0f2f4;margin:0;padding:20px"><div style="max-width:560px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;border:1px solid #e4e8eb"><div style="background:#003C50;padding:20px 28px;text-align:center"><img src="${BRAND.logoUrl}${BRAND.logo.blanco}" alt="${BRAND.nombre}" height="28" width="184" style="height:28px;width:184px;display:inline-block;border:0"/></div><div style="padding:28px"><div style="font-size:14px;color:#666;margin:0 0 6px">Estimadas ${NOTA_DIRIGIDO},</div><div style="font-size:14px;color:#666;margin:0 0 16px">Espero que estén muy bien. Revisando la liquidación, encontramos las siguientes OT que <b>no logramos reconocer</b> como trabajos de nuestra oficina. ¿Nos podrían dar más detalle (compareciente, materia, a qué corresponden) para poder identificarlas?</div><table style="width:100%;border-collapse:collapse"><tr style="border-bottom:1px solid #E4E8EB"><td style="font-size:10px;color:#99ABB4;text-transform:uppercase;padding:4px 0">OT</td><td style="font-size:10px;color:#99ABB4;text-transform:uppercase;padding:4px 8px">Detalle que tenemos</td><td style="font-size:10px;color:#99ABB4;text-transform:uppercase;padding:4px 0;text-align:right">Monto</td></tr>${filas}</table><div style="font-size:13px;color:#666;margin:16px 0 0">Quedamos atentos.<br><br>Saludos cordiales,<br><b style="color:#1a1a1a">${BRAND.nombre}</b></div></div><div style="padding:16px 28px;border-top:1px solid #eee;font-size:11px;color:#999">${BRAND.dominio} · ${BRAND.nombre}</div></div></body></html>`
      const texto=`Estimadas ${NOTA_DIRIGIDO},\n\nEspero que estén muy bien. Revisando la liquidación, encontramos las siguientes OT que no logramos reconocer como trabajos de nuestra oficina. ¿Nos podrían dar más detalle para identificarlas?\n\n`+selRows.map(r=>`• ${otDe(r)} · ${(r.materia||r.concepto||'—')}${r.nombre||r.requirente?` · ${r.nombre||r.requirente}`:''} · $${(r.monto||0).toLocaleString('es-CL')}`).join('\n')+'\n\nQuedamos atentos.\nSaludos cordiales,\n'+BRAND.nombre
      const subject=`Consulta sobre OT no reconocidas — ${BRAND.nombre} — ${new Date().toLocaleDateString('es-CL')}`
      const via=await enviarComoUsuario({to:dest,cc:ccEstudio,subject,html,text:texto,que:'La consulta a la notaría'})
      if(via===null){ setConsultando(false); return }   // no salió: enviarComoUsuario ya avisó qué hacer
      flash(txtEnviado(via,{que:`Consulta por ${selRows.length} OT`, g:'a', para:dest}))
      setNotaConsultaSel(new Set())
    }catch(e){ appAlert('No se pudo enviar la consulta: '+(e.message||e)) }
    setConsultando(false)
  }
  const [driveBusy,setDriveBusy] = useState(null)   // fila con búsqueda en Drive en curso
  const [driveMsg,setDriveMsg] = useState({})       // resultado de la búsqueda en Drive por fila
  const [driveAll,setDriveAll] = useState(null)     // {done,total} de "Buscar todas en Drive"
  const [deselNota,setDeselNota] = useState(()=>new Set())   // notaría: OT DESmarcadas (por defecto van marcadas las que tienen cliente)
  const [rowOpenNota,setRowOpenNota] = useState(()=>new Set())   // notaría: filas expandidas (detalle clickeable)
  const [similarPrompt,setSimilarPrompt] = useState(null)   // {clientId,clientName,ids,srcName}: al asignar, ofrece asignar las OT de compareciente parecido
  const [grpOpen,setGrpOpen] = useState(()=>new Set())   // notaría: grupos de cliente expandidos (por defecto colapsados)
  const [enAppOpen,setEnAppOpen] = useState(false)       // notaría: grupo "ya en la app" expandido
  const [catOpen,setCatOpen] = useState(()=>new Set())   // notaría: categorías (tarjetas) abiertas; TODO replegado por defecto (se abre al tocar)
  const [catQ,setCatQ] = useState({})                    // notaría: buscador por categoría (key→texto)
  const [rcOpen,setRcOpen] = useState(false)             // notaría: detalle "A clientes" del recibo desplegado
  const [aprendido,setAprendido] = useState({})          // notaría: aviso transitorio "lo aprendí" por fila
  const [aprendidasSet,setAprendidasSet] = useState(()=>new Set())   // notaría: filas que aprendiste a mano esta carga (para el chip del hero)
  const [confDesel,setConfDesel] = useState(()=>new Set())   // notaría: sugeridas DESmarcadas (por defecto todas marcadas para confirmar)
  const [touched,setTouched] = useState(false)   // hubo cambios en la revisión sin cargar aún
  const [accionMsg,setAccionMsg] = useState('')  // toast breve de confirmación por acción
  const flash = (msg) => { setTouched(true); setAccionMsg(msg); setTimeout(()=>setAccionMsg(m=>m===msg?'':m),3000) }
  const hayPendiente = !!rows && !resultado && touched   // cambios sin cargar
  useEffect(()=>{ if(dirtyRef) dirtyRef.current = hayPendiente },[hayPendiente,dirtyRef])
  useEffect(()=>{ if(!hayPendiente) return; const h=e=>{ e.preventDefault(); e.returnValue='' }; window.addEventListener('beforeunload',h); return ()=>window.removeEventListener('beforeunload',h) },[hayPendiente])
  const toggleCat = k => setCatOpen(p=>{ const n=new Set(p); n.has(k)?n.delete(k):n.add(k); return n })
  const driveAutoRef = useRef(false)   // Drive corre solo UNA vez al abrir "Falta el cliente" (busca cliente por carpeta y asigna lo seguro)
  useEffect(()=>{ if(!notaria || !rows || driveAutoRef.current || driveAll) return
    if(catOpen.has('falta')){ const nSin=(rows||[]).filter(r=>!r.client_id&&!r.personal_de&&!r.isInternal&&!r.error&&!r.suggestion).length; if(nSin>=2 && nSin<=40){ driveAutoRef.current=true; buscarTodasDrive() } } },[catOpen,rows,notaria])
  const toggleGrpNota = cid => setGrpOpen(p=>{ const n=new Set(p); n.has(cid)?n.delete(cid):n.add(cid); return n })
  // Seleccionada para importar = tiene destino (cliente, oficina o miembro), no es error, no está ya en la app, no fue desmarcada.
  // Una sola definición: de aquí salen el contador del banner, el botón "Importar seleccionadas" y el recibo → todo cuadra.
  const notaSelOn = r => (!!r.client_id || !!r.personal_de) && !r.error && !dupInfo[r.id]?.otState && !dupInfo[r.id]?.sinNum && !deselNota.has(r.id)
  const toggleSelNota = id => setDeselNota(p=>{ const n=new Set(p); n.has(id)?n.delete(id):n.add(id); return n })
  const toggleRowNota = id => setRowOpenNota(p=>{ const n=new Set(p); n.has(id)?n.delete(id):n.add(id); return n })
  // Alertas de duplicado por fila: OT ya cargada (se omite) y posible duplicado de un gasto cargado a mano (mismo cliente + glosa parecida).
  const _normOt = s => String(s||'').replace(/\D/g,'')
  const _STOPDUP = new Set(['para','por','con','los','las','del','sociedad','servicios','contrato','publica','especial','acciones','copia','legalizada','prestacion','mandato','reduccion','protocolizacion','autorizacion','pacto','junta','escritura'])
  const _toksDup = s => new Set(String(s||'').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/[^a-z0-9 ]/g,' ').split(/\s+/).filter(w=>w.length>=4&&!_STOPDUP.has(w)))
  const dupInfo = useMemo(()=>{
    const m={}
    const byOt=new Map(); (expenses||[]).forEach(e=>{ if(!e.deleted_at&&e.ot_number){ const o=_normOt(e.ot_number); if(o) byOt.set(o,e) } })
    // La OT de la notaría es la fuente de la verdad: un gasto de notaría del mismo cliente y monto que se cargó SIN N° de OT
    // recibe el número (no se duplica). Fecha a ≤60 días si ambas existen; se usa a lo más una vez.
    const sinNumPool=(expenses||[]).filter(e=>!e.deleted_at&&e.type!=='fondo'&&e.category==='Notaria'&&!_normOt(e.ot_number)), usadoSN=new Set()
    const dias=(a,b)=>(a&&b)?Math.abs(new Date(a)-new Date(b))/864e5:null
    ;(rows||[]).forEach(r=>{
      const info={}
      const o=_normOt(r.ot)
      if(o&&!byOt.has(o)&&notaria&&r.client_id&&!r.error&&(r.monto||0)>1){
        const cands=sinNumPool.filter(e=>!usadoSN.has(e.id)&&String(e.client_id)===String(r.client_id)&&Number(e.amount)===Number(r.monto)&&(dias(e.date,r.fecha)==null||dias(e.date,r.fecha)<=60))
          .sort((a,b)=>(dias(a.date,r.fecha)??999)-(dias(b.date,r.fecha)??999))
        if(cands.length){ usadoSN.add(cands[0].id); info.sinNum=cands[0] } }
      if(o&&byOt.has(o)){ const e=byOt.get(o); info.otDup=e
        if(notaria&&(r.monto||0)>1&&Number(e.amount)!==Number(r.monto)) info.montoNot={app:Number(e.amount)||0, notaria:r.monto}   // la notaría manda
        // Estado de la OT que ya existe → alarma respectiva. "Pagada" = está en tu correo/liquidación a la notaría.
        info.otState = (e.notaria_liquidado_at||e.notaria_render_id) ? 'pagada'
          : (e.client_render_id||e.client_rendered_at||e.render_id||e.rendered_at) ? 'rendida'
          : 'cargada' }
      if(r.client_id){
        const rt=_toksDup(`${r.concepto} ${r.subconcepto||''}`)
        const cand=(expenses||[]).find(e=>{ if(e.deleted_at||e.bulk_import_id||e.client_id!==r.client_id) return false; const et=_toksDup(`${e.concept} ${e.subconcept||''}`); let n=0; et.forEach(w=>{ if(rt.has(w)) n++ }); return n>=2 })
        if(cand) info.manualDup=cand
      }
      if(info.otDup||info.manualDup||info.sinNum) m[r.id]=info
    })
    return m
  },[rows,expenses,notaria])
  const listas = (rows||[]).filter(rowReady)
  const sugeridos = (rows||[]).filter(r=>!!r.suggestion)
  const nAuto = (rows||[]).filter(r=>bucketOf(r)==='auto').length
  const nRev = (rows||[]).filter(r=>bucketOf(r)==='rev').length
  const nMan = (rows||[]).filter(r=>bucketOf(r)==='man').length
  const dups = (rows||[]).filter(r=>r.dup)
  const totalMonto = (rows||[]).filter(r=>!r.error).reduce((a,r)=>a+(r.monto||0),0)
  const editarCampo = (rowId,campo,valor) => { setTouched(true); return setRows(p=>{
    const src=p.find(r=>r.id===rowId)
    // Notaría: al editar la glosa, aprende materia→glosa y la aplica en lote a las OT del mismo trámite no editadas a mano.
    if(notaria && campo==='concepto' && src){
      const mk=catNorm(src.materia)
      if(mk){ glosaLearnedRef.current={...glosaLearnedRef.current,[mk]:valor}; if(!DEMO) setLearningKV('notaria_glosa',mk,valor).catch(()=>{}) }
      return p.map(r=> r.id===rowId ? {...r,concepto:valor,glosaEdited:true} : (mk && !r.glosaEdited && catNorm(r.materia)===mk) ? {...r,concepto:valor} : r)
    }
    return p.map(r=>r.id===rowId?{...r,[campo]:valor}:r)
  }) }

  // Notaría: ordena las filas del preview en GRUPOS por cliente (por revisar arriba). Devuelve una secuencia de {type:'header'|'row'}.
  // El cuerpo de cada fila se renderiza igual que en la lista plana (no se duplica); solo se intercalan encabezados de grupo.
  const notaItems = (flt) => {
    const byClient={}, sinCli=[], enApp=[]
    flt.forEach(r=>{ if(dupInfo[r.id]?.otState||dupInfo[r.id]?.sinNum){ enApp.push(r); return }   // ya en la app (pagada/rendida/cargada) → grupo aparte
      if(r.client_id && !esOficinaCli(r.client_id)) (byClient[r.client_id]=byClient[r.client_id]||[]).push(r); else sinCli.push(r) })
    const groups = Object.entries(byClient).map(([cid,rs])=>{ const c=clients.find(x=>String(x.id)===String(cid)); const tot=rs.reduce((a,r)=>a+(r.monto||0),0); let saldo=null; try{ saldo=saldoCliente(expenses,cid) }catch(_){}; const nRev=rs.filter(r=>bucketOf(r)!=='auto').length; return {cid,name:c?.name||'Cliente',nEnt:entsOf(cid).length,tot,saldo,nRev,rs} })
    groups.sort((a,b)=>(b.nRev>0?1:0)-(a.nRev>0?1:0) || b.tot-a.tot)
    const out=[]
    // Por revisar (subagrupado por compareciente: los repetidos van juntos)
    if(sinCli.length){
      out.push({type:'header',kind:'sin',n:sinCli.length,tot:sinCli.reduce((a,r)=>a+(r.monto||0),0)})
      const by={}; sinCli.forEach(r=>{ const k=(sinNombreReal(r.nombre||r.requirente)?'':normName(r.nombre||r.requirente||''))||('id'+r.id); (by[k]=by[k]||[]).push(r) })
      Object.values(by).sort((a,b)=>b.length-a.length||b[0].monto-a[0].monto).forEach(rs=>{ if(rs.length>1) out.push({type:'sub',name:rs[0].nombre||'—',n:rs.length,tot:rs.reduce((a,r)=>a+(r.monto||0),0)}); rs.forEach(r=>out.push({type:'row',r})) })
    }
    // Clientes (colapsables; por defecto cerrados)
    groups.forEach(g=>{ out.push({type:'header',kind:'cli',g}); if(grpOpen.has(g.cid)) g.rs.forEach(r=>out.push({type:'row',r})) })
    // Ya en la app (colapsado; se omiten al importar)
    if(enApp.length){ out.push({type:'header',kind:'app',n:enApp.length,tot:enApp.reduce((a,r)=>a+(r.monto||0),0)}); if(enAppOpen) enApp.forEach(r=>out.push({type:'row',r})) }
    return out
  }
  // Fila COMPACTA de notaría: checkbox (si tiene cliente) + OT · trámite · cliente · monto, clickeable para expandir el detalle completo.
  const notaRowCard = (r) => {
    const open=rowOpenNota.has(r.id), sel=notaSelOn(r)
    const cn=r.client_id?(clients.find(c=>String(c.id)===String(r.client_id))?.name||r.clientName||''):null
    const tramite=((r.materia||'').trim().toLowerCase().replace(/^./,c=>c.toUpperCase()))||'Trámite notarial'
    const otL=r.ot?(String(r.ot).toUpperCase().startsWith('OT')?r.ot:'OT-'+r.ot):'s/OT'
    const st=dupInfo[r.id]?.otState
    const chk=on=> on
      ? <svg width='17' height='17' viewBox='0 0 24 24' fill={C.accent} stroke={C.accent}><rect x='3' y='3' width='18' height='18' rx='4'/><path d='M8 12l3 3 5-6' stroke='#fff' strokeWidth='2.4' fill='none' strokeLinecap='round' strokeLinejoin='round'/></svg>
      : <svg width='17' height='17' viewBox='0 0 24 24' fill='none' stroke={C.done} strokeWidth='1.6'><rect x='3' y='3' width='18' height='18' rx='4'/></svg>
    return (
      <div key={r.id} style={{borderTop:`0.5px solid ${C.border}`}}>
        <div style={{display:'flex',alignItems:'center',gap:9,padding:'10px 12px',background:sel?'#fff':C.bgSoft}}>
          {r.client_id&&!r.error ? <span onClick={()=>toggleSelNota(r.id)} title={sel?'Seleccionada — se importa':'Marca para importar'} style={{cursor:'pointer',flexShrink:0,display:'inline-flex'}}>{chk(sel)}</span> : <span style={{width:17,flexShrink:0}}/>}
          <span onClick={()=>toggleRowNota(r.id)} style={{flex:1,minWidth:0,display:'flex',alignItems:'center',gap:8,cursor:'pointer'}}>
            <span style={{fontSize:11,fontWeight:700,color:r.error?C.overdueText:C.azulInfo,flexShrink:0}}>{otL}</span>
            <span style={{flex:1,minWidth:0,fontSize:12,color:C.text,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{tramite}{cn?<span style={{color:C.muted}}> · {cn}</span>:r.suggestion?<span style={{color:C.soonText}}> · sugerido: {r.suggestion.name}</span>:(!r.personal_de?<span style={{color:C.overdueText}}> · sin cliente</span>:'')}</span>
            <span style={{fontSize:12,fontWeight:600,color:C.text,flexShrink:0}}>{fmt(r.monto)}</span>
            <span style={{fontSize:13,color:C.textSoft,flexShrink:0,transform:open?'rotate(90deg)':'none',transition:'transform .15s'}}><Gl n='chevron'/></span>
          </span>
        </div>
        {st&&<div style={{fontSize:11,fontWeight:600,color:st==='pagada'?C.overdueText:st==='rendida'?C.coralText:C.muted,padding:'0 12px 6px 38px'}}>{st==='pagada'?'Ya pagada a la notaría — no la cargues de nuevo':st==='rendida'?'Ya rendida al cliente':(dupInfo[r.id]?.montoNot?`Ya cargada — el monto se actualiza al de la notaría (${fmt(dupInfo[r.id].montoNot.app)} → ${fmt(dupInfo[r.id].montoNot.notaria)})`:'Ya cargada — se omite al importar')}</div>}
        {!st&&dupInfo[r.id]?.sinNum&&<div style={{fontSize:11,fontWeight:600,color:C.muted,padding:'0 12px 6px 38px'}}>Ya estaba cargada sin N° de OT — se le pone el número</div>}
        {open&&<div style={{padding:'2px 12px 12px 38px',background:sel?'#fff':C.bgSoft}}>
          <table style={{width:'100%',fontSize:12,borderCollapse:'collapse'}}><tbody>
            <tr><td style={{color:C.muted,padding:'2px 0',width:96,verticalAlign:'top'}}>Trámite</td><td style={{padding:'2px 0',color:C.text}}>{r.materia||'—'}</td></tr>
            <tr><td style={{color:C.muted,padding:'2px 0',verticalAlign:'top'}}>Compareciente</td><td style={{padding:'2px 0',color:C.text}}>{r.nombre||'—'}</td></tr>
            <tr><td style={{color:C.muted,padding:'2px 0'}}>Fecha</td><td style={{padding:'2px 0',color:C.text}}>{r.fecha?fmtFDMY(r.fecha):'sin fecha'}</td></tr>
          </tbody></table>
          <div style={{marginTop:7}}>
            <div style={{fontSize:10,color:C.muted,textTransform:'uppercase',letterSpacing:.4,marginBottom:3}}>Glosa a rendir · editable</div>
            <input value={r.concepto} onChange={e=>editarCampo(r.id,'concepto',e.target.value)} style={{width:'100%',padding:'6px 9px',borderRadius:8,border:`1px solid ${C.border}`,fontSize:12,background:'#fff',color:C.text,outline:'none',boxSizing:'border-box'}}/>
          </div>
          <div style={{marginTop:8,display:'flex',alignItems:'center',gap:8,flexWrap:'wrap'}}>
            {cn&&<span style={{fontSize:12,color:C.muted}}>Cliente: <b style={{color:C.accent}}>{cn}</b></span>}
            <span style={{marginLeft:cn?'auto':0,flex:cn?'0 0 auto':'1 1 180px',minWidth:170}}><AsignarClienteInline bill={{id:r.id}} clients={clients} onAssign={(_,cid)=>asignar(r.id,cid)} label={cn?'Cambiar cliente…':'Buscar cliente por nombre o RUT…'}/></span>
          </div>
          {r.suggestion&&!r.client_id&&<div style={{marginTop:7,display:'flex',alignItems:'center',gap:8}}><span style={{fontSize:12,color:C.text}}>Sugerido: <b>{r.suggestion.name}</b>{r.confidence?<span style={{color:C.muted}}> · {r.confidence}%</span>:''}</span><button onClick={()=>asignar(r.id,r.suggestion.id)} style={{fontSize:11,fontWeight:700,color:'#fff',background:C.greenText,border:'none',borderRadius:8,padding:'4px 11px',cursor:'pointer'}}>Confirmar</button></div>}
          {!r.client_id&&!r.personal_de&&<div style={{marginTop:7,display:'flex',gap:6,flexWrap:'wrap',alignItems:'center'}}>
            <button disabled={driveBusy===r.id} onClick={async()=>{ setDriveBusy(r.id); setDriveMsg(m=>({...m,[r.id]:''})); const res=await driveFindClient(r.nombre||r.requirente); setDriveBusy(null); if(res&&res.client){ asignar(r.id,res.client.id); setDriveMsg(m=>({...m,[r.id]:`✓ ${res.client.name} · carpeta "${res.folder}"`})) } else setDriveMsg(m=>({...m,[r.id]:res&&res.error?('Error: '+res.error):'No lo encontré en Drive'})) }} style={{fontSize:11,fontWeight:600,color:C.accent,background:C.azulBg,border:'none',borderRadius:8,padding:'5px 10px',cursor:driveBusy===r.id?'default':'pointer'}}>{driveBusy===r.id?'Buscando en Drive…':'Buscar en Drive'}</button>
            {r.nombre&&onCreateOccasional&&<button onClick={()=>setOcasPick(ocasPick===r.id?null:r.id)} style={{fontSize:11,fontWeight:600,color:C.accent,background:'#fff',border:`1px solid ${C.border}`,borderRadius:8,padding:'5px 10px',cursor:'pointer'}}>Cliente nuevo</button>}
            {driveMsg[r.id]&&<span style={{fontSize:11,fontWeight:600,color:driveMsg[r.id].startsWith('✓')?C.greenText:C.muted}}>{driveMsg[r.id]}</span>}
          </div>}
          {ocasPick===r.id&&<div style={{marginTop:6,display:'flex',gap:6,flexWrap:'wrap',alignItems:'center'}}><span style={{fontSize:10,color:C.muted,fontWeight:600}}>Ocasional «{r.nombre}» · resp:</span>{MIEMBROS_NOTA.map(m=>{const pc=personChip(m);return <button key={m} onClick={()=>crearOcasional(r,m)} style={{fontSize:10,borderRadius:20,padding:'3px 9px',fontWeight:600,cursor:'pointer',background:pc.bg,color:pc.color,border:'none'}}>{m}</button>})}<button onClick={()=>crearOcasional(r,null)} style={{fontSize:10,borderRadius:20,padding:'3px 9px',fontWeight:600,cursor:'pointer',background:C.bgWarm,color:C.grisText,border:'none'}}>Sin resp.</button></div>}
        </div>}
      </div>
    )
  }

  // ── Revisión notaría por CATEGORÍAS (tarjetas, patrón de la app) ────────────────────────────
  // Reparte las filas en 6 categorías accionables. Cada una es una tarjeta plegable; adentro, filas
  // que muestran compareciente + trámite + fecha (lo que identifica de quién es).
  // La notaría manda: una OT que ya está en la app cambió de monto en el archivo, o la notaría la dejó sin cobro ($0 / $1 = sin efecto o de registro).
  // Devuelve {antes, ahora, st, yaCambio} o null. Solo 'cargada' se ajusta sola al cargar; pagada/rendida solo avisan la diferencia.
  const cambioNota = r => { if(!notaria) return null; const d=dupInfo[r.id]; const e=d?.otDup; if(!e) return null
    const antes=Number(e.amount)||0
    const sinCobro=!!r.error&&/sin efecto|de registro|sin cobro/i.test(r.error)
    const ahora=sinCobro?0:(d.montoNot?Number(d.montoNot.notaria)||0:null)
    if(ahora==null||(sinCobro&&antes<=1)||ahora===antes) return null
    return {antes, ahora, st:d.otState, yaCambio:/ajustado por la notar[ií]a|monto seg[uú]n estado|seg[uú]n la notar[ií]a/i.test(e.notas||''), sinCobro} }
  const notaCats = (flt) => {
    const c={falta:[],confirma:[],proyecto:[],listas:[],personal:[],oficina:[],yacargadas:[],nonuestra:[],sinefecto:[],errores:[],cambios:[]}
    flt.forEach(r=>{
      if(cambioNota(r)){ c.cambios.push(r); return }   // OT ya en la app cuyo monto la notaría cambió o dejó sin cobro ($0/$1)
      if(r.error){ if(/sin efecto|de registro|sin cobro/i.test(r.error)) c.sinefecto.push(r); else c.errores.push(r); return }   // 'Sin efecto (anulada)' aparte de errores reales (ej. 'OT no detectada')
      if(r.noNuestra){ c.nonuestra.push(r); return }   // "No es nuestra": OT correcta pero no la paga la oficina → no se carga, solo se registra + avisa a la notaría (reversible)
      if(dupInfo[r.id]?.otState||dupInfo[r.id]?.sinNum){ c.yacargadas.push(r); return }
      if(r.personal_de){ c.personal.push(r); return }   // gasto personal de un miembro (Cristóbal/Erasmo/…)
      if(r.isInternal || (r.client_id && esOficinaCli(r.client_id))){ c.oficina.push(r); return }
      if(r.client_id){ (proyDe(r).need||r.proyRev ? c.proyecto : c.listas).push(r); return }
      if(r.suggestion){ c.confirma.push(r); return }
      c.falta.push(r)
    })
    return c
  }
  const CAT_META = {
    falta:{t:'Falta el cliente', s:'búscalo, míralo en Drive o créalo', col:C.overdueText, bg:C.overdueBg},
    confirma:{t:'Confirma el cliente', s:'cliente propuesto · por confirmar', col:C.soonText, bg:C.soonBg},
    proyecto:{t:'Proyecto por revisar', s:'con cliente · sin proyecto seguro · opcional', col:C.soonText, bg:C.soonBg},
    listas:{t:'Listas para cargar', s:'con cliente · agrupadas por cliente', col:C.greenText, bg:C.greenBg},
    personal:{t:'Personal · de un miembro', s:'de un abogado/miembro, no de un cliente', col:C.grisText, bg:C.bgWarm},
    oficina:{t:'De la oficina', s:'no van a un cliente', col:C.tealText, bg:C.tealBg},
    yacargadas:{t:'Ya cargadas', s:'están en la app · se omiten', col:C.muted, bg:C.bgSoft},
    nonuestra:{t:'No son nuestras · avisar a la notaría', s:'OT correctas pero no las paga la oficina · no se cargan, se registran', col:C.overdueText, bg:C.overdueBg},
    sinefecto:{t:'Sin efecto o de registro', s:'anuladas u OT de $1 · no se cobran', col:C.grisText, bg:C.bgWarm},
    errores:{t:'Con error · no se cargan', s:'revísalas (ej. OT no detectada en el archivo)', col:C.overdueText, bg:C.overdueBg},
    cambios:{t:'Cambios de la notaría', s:'ya en la app · monto distinto o ya no se cobra', col:C.soonText, bg:C.soonBg},
  }
  const catSvg = (k,col) => { const p={proyecto:['M3 7h6l2 2h10v10H3z'],falta:['M4 19c0-3 2-5 5-5','M17 12v4M17 19v.01'],confirma:['M12 3v2M12 19v2M3 12h2M19 12h2M6 6l1 1M17 17l1 1'],listas:['M5 13l4 4L19 7'],personal:['M5 20c0-4 3.5-6 7-6s7 2 7 6'],oficina:['M8 7h4M8 11h4M8 15h4M16 9h4v12h-4'],yacargadas:['M3 4v4h4','M12 8v4l3 2'],nonuestra:['M15 9l-6 6M9 9l6 6'],sinefecto:['M6 6l12 12'],errores:['M12 9v4','M12 17v.01'],cambios:['M4 8h14l-3-3','M20 16H6l3 3']}[k]||[]
    const base = k==='falta'?<circle cx='9' cy='8' r='3'/>:k==='confirma'?<circle cx='12' cy='12' r='3.5'/>:k==='personal'?<circle cx='12' cy='8' r='3.5'/>:k==='oficina'?<rect x='4' y='3' width='12' height='18' rx='1'/>:k==='yacargadas'?<path d='M3 12a9 9 0 1 0 3-6.7L3 8'/>:(k==='sinefecto'||k==='nonuestra')?<circle cx='12' cy='12' r='9'/>:null
    return <svg width='18' height='18' viewBox='0 0 24 24' fill='none' stroke={col} strokeWidth={k==='listas'?2.4:2} strokeLinecap='round' strokeLinejoin='round'>{base}{p.map((d,i)=><path key={i} d={d}/>)}</svg> }
  const tramDe = r => ((r.materia||'').trim().toLowerCase().replace(/^./,ch=>ch.toUpperCase()))||'Trámite notarial'
  const nomDe = r => r.nombre||r.requirente||'—'
  const otDe = r => r.ot?(String(r.ot).toUpperCase().startsWith('OT')?r.ot:'OT-'+r.ot):'s/OT'
  // Fila identificadora: nombre (protagonista) + monto · trámite · OT+fecha · acciones según categoría.
  const tdL={color:C.muted,padding:'2px 0',width:92,verticalAlign:'top',fontSize:11}, tdV={padding:'2px 0',color:C.text,fontSize:12}
  const notaCatRow = (r,kind) => {
    const open=rowOpenNota.has(r.id)
    const cn=r.client_id?(clients.find(c=>String(c.id)===String(r.client_id))?.name||r.clientName||''):null
    const noName = !String(r.nombre||r.requirente||'').replace(/^\s*n\/?a\.?\s*$/i,'').trim()   // sin compareciente utilizable
    const fy = r.fecha ? new Date(r.fecha).getFullYear() : null
    const oldY = fy && !isNaN(fy) && fy < new Date().getFullYear()   // OT de un año anterior
    const info = kind==='yacargadas'||kind==='sinefecto'||kind==='errores'||kind==='nonuestra'||kind==='cambios'   // solo lectura
    const st = dupInfo[r.id]?.otState
    const cmb = kind==='cambios' ? cambioNota(r) : null
    const stNote = cmb ? (cmb.st==='cargada' ? (cmb.yaCambio ? `Tenía ${fmt(cmb.antes)} · cambió otra vez, confírmalo` : `Tenía ${fmt(cmb.antes)} · se ajusta al cargar`)
        : cmb.st==='pagada' ? `Pagada a ${fmt(cmb.antes)} · ${cmb.ahora>cmb.antes?`faltan ${fmt(cmb.ahora-cmb.antes)}`:`a favor ${fmt(cmb.antes-cmb.ahora)}`}`
        : `Rendida a ${fmt(cmb.antes)} · ${cmb.ahora>cmb.antes?`cobrar ${fmt(cmb.ahora-cmb.antes)}`:`devolver ${fmt(cmb.antes-cmb.ahora)}`} al cliente`)
      : kind==='errores' ? (r.error||'Con error — no se carga') : kind==='nonuestra' ? (r.noNPrev?`Ya marcada como no nuestra el ${fmtFechaDMY(String(r.noNPrev.created_at||'').slice(0,10))} · ${r.noNPrev.estado==='consultada'?'consultada a la notaría':r.noNPrev.estado==='resuelta'?'la notaría respondió':'por consultar'}`:'No es nuestra — no se carga, se avisa a la notaría') : kind==='sinefecto' ? (/de registro/i.test(r.error||'')?'De registro ($1) — no se cobra':'Anulada — no se carga') : dupInfo[r.id]?.sinNum ? `Ya estaba cargada sin N° de OT — se le pone el ${otDe(r)}` : (st==='cargada'&&dupInfo[r.id]?.montoNot) ? `Ya está en la app — el monto se actualiza al de la notaría (${fmt(dupInfo[r.id].montoNot.app)} → ${fmt(dupInfo[r.id].montoNot.notaria)})` : dupInfo[r.id]?.montoNot ? `${st==='pagada'?'Ya pagada a la notaría':'Ya rendida al cliente'} — la notaría cobra ${fmt(dupInfo[r.id].montoNot.notaria)} (en la app ${fmt(dupInfo[r.id].montoNot.app)})` : st==='pagada' ? 'Ya pagada a la notaría' : st==='rendida' ? 'Ya rendida al cliente' : st==='cargada' ? 'Ya está en la app' : null
    const prot = (kind==='listas'||kind==='personal') ? tramDe(r) : (noName ? 'Sin compareciente' : nomDe(r))
    const sub  = kind==='listas' ? (cn||'') : kind==='personal' ? (noName?'':nomDe(r)) : (tramDe(r) + (cn?` · ${cn}`:''))
    const chk = kind==='confirma', on = chk && !confDesel.has(r.id)
    const consChk = kind==='nonuestra', consOn = consChk && notaConsultaSel.has(r.id)   // "No es nuestra": seleccionable para consultar a la notaría
    const desk = isDeskCM
    const selK = (kind==='listas'||kind==='personal'||kind==='oficina'), selOn = selK && notaSelOn(r)
    // Acciones + detalle + selectores de la fila: en escritorio van en una fila propia a lo ancho (OT → monto); en móvil dentro de la tarjeta.
    const extraEl = (<>
        {/* acciones por categoría (no en las informativas) */}
        {kind==='falta'&&<div style={{display:'flex',gap:6,marginTop:8,flexWrap:'wrap',alignItems:'center'}}>
          {!noName&&<button disabled={driveBusy===r.id} onClick={async()=>{ setDriveBusy(r.id); setDriveMsg(m=>({...m,[r.id]:''})); const res=await driveFindClient(r.nombre||r.requirente); setDriveBusy(null); if(res&&res.client){ driveSuggest(r.id,res) } else setDriveMsg(m=>({...m,[r.id]:res&&res.error?('Error: '+res.error):'No lo encontré en Drive'})) }} style={{fontSize:12,fontWeight:700,color:'#fff',background:C.azulInfo,border:'none',borderRadius:8,padding:'7px 13px',cursor:driveBusy===r.id?'default':'pointer',display:'inline-flex',alignItems:'center',gap:6}}><svg width='13' height='13' viewBox='0 0 24 24' fill='none' stroke='#fff' strokeWidth='2' strokeLinecap='round' strokeLinejoin='round'><path d='M22 12l-4-4v3h-8v2h8v3z'/><path d='M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h8'/></svg>{driveBusy===r.id?'Buscando en Drive…':'Buscar en Drive'}</button>}
          <button onClick={()=>toggleRowNota(r.id)} style={{fontSize:12,fontWeight:600,color:C.accent,background:'#fff',border:`1px solid ${C.accent}`,borderRadius:8,padding:'6px 12px',cursor:'pointer'}}>{open?'Cerrar':'Asignar a mano'}</button>
          {onCreateOccasional&&!noName&&<button onClick={()=>setOcasPick(ocasPick===r.id?null:r.id)} style={{fontSize:12,fontWeight:600,color:C.muted,background:'#fff',border:`1px solid ${C.border}`,borderRadius:8,padding:'6px 12px',cursor:'pointer'}}>Nuevo</button>}
          <button onClick={()=>setPersPick(persPick===r.id?null:r.id)} style={{fontSize:12,fontWeight:700,color:C.tealText,background:C.tealBg,border:'none',borderRadius:8,padding:'6px 12px',cursor:'pointer'}}>Gasto interno {persPick===r.id?<Gl n='chevU'/>:<Gl n='chevD'/>}</button>
          <button onClick={()=>marcarNoNuestra(r.id)} title='La notaría la envió pero no es un trabajo de la oficina (cargada por error) → no se carga' style={{fontSize:12,fontWeight:600,color:C.overdueText,background:'none',border:'none',cursor:'pointer',padding:'6px 4px'}}>No es nuestra</button>
          {driveMsg[r.id]&&<span style={{fontSize:11,fontWeight:600,color:driveMsg[r.id].startsWith('✓')?C.greenText:C.muted}}>{driveMsg[r.id]}</span>}
        </div>}
        {kind==='personal'&&<div style={{display:'flex',gap:10,marginTop:6}}><button onClick={()=>setPersPick(persPick===r.id?null:r.id)} style={{fontSize:11,fontWeight:600,color:C.azulInfo,background:'none',border:'none',cursor:'pointer',padding:0}}>Cambiar</button><button onClick={()=>quitarInternoRow(r.id)} style={{fontSize:11,fontWeight:600,color:C.overdueText,background:'none',border:'none',cursor:'pointer',padding:0}}>Ya no es interno</button></div>}
        {kind==='oficina'&&<div style={{display:'flex',gap:10,marginTop:6}}><button onClick={()=>setPersPick(persPick===r.id?null:r.id)} style={{fontSize:11,fontWeight:600,color:C.azulInfo,background:'none',border:'none',cursor:'pointer',padding:0}}>Cambiar (interno)</button><button onClick={()=>toggleRowNota(r.id)} style={{fontSize:11,fontWeight:600,color:C.azulInfo,background:'none',border:'none',cursor:'pointer',padding:0}}>{open?'Cerrar':'Asignar a un cliente'}</button><button onClick={()=>quitarInternoRow(r.id)} style={{fontSize:11,fontWeight:600,color:C.overdueText,background:'none',border:'none',cursor:'pointer',padding:0}}>Quitar</button></div>}
        {kind==='confirma'&&r.suggestion&&<div style={{display:'flex',gap:7,marginTop:8,alignItems:'center',flexWrap:'wrap'}}>
          <span style={{fontSize:12,color:C.text}}>{r.suggestFrom==='drive'?<>Encontrado en Drive: <b>{r.suggestion.name}</b>{r.driveFolder?<span style={{color:C.muted}}> · carpeta "{r.driveFolder}"</span>:''}</>:<>Sugerido: <b>{r.suggestion.name}</b>{r.confidence?<span style={{color:C.muted}}> · {r.confidence}% de certeza</span>:''}</>}</span>
          <button onClick={()=>asignar(r.id,r.suggestion.id)} style={{fontSize:12,fontWeight:700,color:'#fff',background:C.greenText,border:'none',borderRadius:8,padding:'5px 11px',cursor:'pointer'}}>Confirmar</button>
          <button onClick={()=>toggleRowNota(r.id)} style={{fontSize:12,fontWeight:600,color:C.muted,background:'none',border:'none',cursor:'pointer'}}>Otro</button>
          <button onClick={()=>setPersPick(persPick===r.id?null:r.id)} style={{fontSize:12,fontWeight:700,color:C.tealText,background:C.tealBg,border:'none',borderRadius:8,padding:'5px 11px',cursor:'pointer'}}>Gasto interno {persPick===r.id?<Gl n='chevU'/>:<Gl n='chevD'/>}</button>
        </div>}
        {kind==='listas'&&proyCampo(r)&&<div style={{marginTop:6}}>{proyCampo(r)}</div>}
        {kind==='listas'&&<div style={{display:'flex',gap:12,marginTop:6,flexWrap:'wrap',alignItems:'center'}}><button onClick={()=>toggleRowNota(r.id)} style={{fontSize:11,fontWeight:600,color:C.azulInfo,background:'none',border:'none',cursor:'pointer',padding:0}}>{open?'Cerrar':'Cambiar cliente'}</button><button onClick={()=>setPersPick(persPick===r.id?null:r.id)} style={{fontSize:11,fontWeight:600,color:C.tealText,background:'none',border:'none',cursor:'pointer',padding:0}}>Gasto interno {persPick===r.id?<Gl n='chevU'/>:<Gl n='chevD'/>}</button><button onClick={()=>marcarNoNuestra(r.id)} title='La notaría la envió pero no es un trabajo de la oficina → no se carga' style={{fontSize:11,fontWeight:600,color:C.overdueText,background:'none',border:'none',cursor:'pointer',padding:0}}>No es nuestra</button></div>}
        {kind==='nonuestra'&&<div style={{marginTop:6}}><button onClick={()=>reactivarRow(r.id)} style={{fontSize:11,fontWeight:600,color:C.azulInfo,background:'none',border:'none',cursor:'pointer',padding:0}}>Sí es nuestra · volver a la revisión</button></div>}
        {open&&<div style={{marginTop:8,padding:'9px 11px',background:'#EEF4FB',border:'1px solid #CFE0F2',borderRadius:10}}>
          {/* Descripción completa para confirmar bien (misma en toda categoría) */}
          <table style={{width:'100%',borderCollapse:'collapse',marginBottom:info?0:9}}><tbody>
            <tr><td style={tdL}>Trámite</td><td style={tdV}>{r.materia||'—'}</td></tr>
            {r.subconcepto&&<tr><td style={tdL}>Detalle</td><td style={tdV}>{r.subconcepto}</td></tr>}
            <tr><td style={tdL}>Compareciente</td><td style={tdV}>{r.nombre||r.requirente||'—'}{r.rut?<span style={{color:C.muted}}> · {fmtRutCL(r.rut)}</span>:''}</td></tr>
            <tr><td style={tdL}>Fecha</td><td style={tdV}>{r.fecha?fmtFDMY(r.fecha):'sin fecha'}</td></tr>
            {r.abogadoResp&&<tr><td style={tdL}>Abogado</td><td style={tdV}>{r.abogadoResp}</td></tr>}
            {cn&&<tr><td style={tdL}>Cliente</td><td style={tdV}><b style={{color:C.accent}}>{cn}</b></td></tr>}
            {r.notas&&<tr><td style={tdL}>Observación</td><td style={tdV}>{r.notas}</td></tr>}
          </tbody></table>
          {!info&&<>
            <div style={{fontSize:10,color:C.muted,textTransform:'uppercase',letterSpacing:.4,marginBottom:3}}>Glosa a rendir · editable</div>
            <input value={r.concepto} onChange={e=>editarCampo(r.id,'concepto',e.target.value)} style={{width:'100%',padding:'6px 9px',borderRadius:8,border:`1px solid ${C.border}`,fontSize:12,background:'#fff',color:C.text,outline:'none',boxSizing:'border-box',marginBottom:8}}/>
            <AsignarClienteInline bill={{id:r.id}} clients={clients} onAssign={(_,cid)=>asignar(r.id,cid)} label={cn?'Cambiar cliente…':'Buscar cliente por nombre o RUT…'}/>
          </>}
        </div>}
        {ocasPick===r.id&&<div style={{marginTop:7,display:'flex',gap:6,flexWrap:'wrap',alignItems:'center'}}><span style={{fontSize:10,color:C.muted,fontWeight:600}}>Ocasional «{r.nombre}» · resp:</span>{MIEMBROS_NOTA.map(m=>{const pc=personChip(m);return <button key={m} onClick={()=>crearOcasional(r,m)} style={{fontSize:10,borderRadius:20,padding:'3px 9px',fontWeight:600,cursor:'pointer',background:pc.bg,color:pc.color,border:'none'}}>{m}</button>})}<button onClick={()=>crearOcasional(r,null)} style={{fontSize:10,borderRadius:20,padding:'3px 9px',fontWeight:600,cursor:'pointer',background:C.bgWarm,color:C.grisText,border:'none'}}>Sin resp.</button></div>}
        {persPick===r.id&&(()=>{ const esOfi=r.client_id&&esOficinaCli(r.client_id); return (
          <div style={{marginTop:8,border:`1px solid ${C.border}`,borderRadius:12,overflow:'hidden',background:'#fff'}}>
            <div style={{...SEC_LBL,padding:'9px 12px 6px'}}>{r.suggestion||r.client_id?'O márcalo como gasto interno — ¿de quién es?':'¿De quién es este gasto?'}</div>
            <div onClick={()=>marcarOficinaRow(r.id)} style={{display:'flex',alignItems:'center',gap:11,padding:'10px 12px',borderTop:`.5px solid ${C.track}`,cursor:'pointer',background:esOfi?C.tealBg:'transparent'}}>
              <span style={{width:30,height:30,borderRadius:10,background:C.tealBg,display:'inline-flex',alignItems:'center',justifyContent:'center',flexShrink:0}}><svg width='16' height='16' viewBox='0 0 24 24' fill='none' stroke={C.tealText} strokeWidth='2'><rect x='4' y='3' width='12' height='18' rx='1'/><path d='M8 7h4M8 11h4M8 15h4M16 9h4v12h-4'/></svg></span>
              <div style={{flex:1,minWidth:0}}><div style={{fontSize:13,fontWeight:700,color:esOfi?C.tealText:C.text}}>De la oficina</div><div style={{fontSize:10,color:C.muted}}>no va a un cliente</div></div>
              <span style={{color:C.textSoft,fontSize:16}}><Gl n='chevron'/></span>
            </div>
            <div style={{fontSize:10,fontWeight:800,textTransform:'uppercase',letterSpacing:.4,color:C.textSoft,padding:'8px 12px 4px',background:C.bgSoft,borderTop:`.5px solid ${C.track}`}}>De un miembro</div>
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr'}}>
              {MIEMBROS_NOTA.map((m,mi)=>{ const pc=personChip(m); const on=r.personal_de===m; return (
                <div key={m} onClick={()=>marcarPersonalRow(r.id,m)} style={{display:'flex',alignItems:'center',gap:8,padding:'10px 12px',borderTop:`.5px solid ${C.track}`,borderRight:mi%2===0?`.5px solid ${C.track}`:'none',cursor:'pointer',background:on?pc.bg:'transparent'}}>
                  <span style={{width:7,height:7,borderRadius:'50%',background:pc.color,flexShrink:0}}/>
                  <span style={{fontSize:13,fontWeight:700,color:on?pc.color:C.text}}>{m}</span>
                </div>
              )})}
            </div>
          </div>
        )})()}
    </>)
    return (
      <div key={r.id} style={desk?{display:'grid',gridTemplateColumns:'16px 76px minmax(0,1fr) 92px',columnGap:10,alignItems:'start',padding:'10px 0',borderTop:`0.5px solid ${C.bgSoft}`,opacity:info&&!consChk?.85:1,background:open?C.bgPanel:'transparent'}:{padding:'10px 12px',display:'flex',gap:10,opacity:info&&!consChk?.85:1,background:'#fff',border:`1px solid ${open?C.azulInfo:C.border}`,borderRadius:12,marginBottom:8,boxShadow:open?'0 2px 10px rgba(24,95,165,.10)':'none'}}>
        {chk&&<span onClick={()=>setConfDesel(p=>{ const n=new Set(p); n.has(r.id)?n.delete(r.id):n.add(r.id); return n })} title={on?'Marcada — se confirma':'Marca para confirmar'} style={{cursor:'pointer',flexShrink:0,marginTop:2}}>{on?<svg width='17' height='17' viewBox='0 0 24 24' fill={C.normal} stroke={C.normal}><rect x='3' y='3' width='18' height='18' rx='4'/><path d='M8 12l3 3 5-6' stroke='#fff' strokeWidth='2.4' fill='none' strokeLinecap='round' strokeLinejoin='round'/></svg>:<svg width='17' height='17' viewBox='0 0 24 24' fill='none' stroke={C.done} strokeWidth='1.6'><rect x='3' y='3' width='18' height='18' rx='4'/></svg>}</span>}
        {consChk&&<span onClick={()=>toggleConsulta(r.id)} title={consOn?'Seleccionada para consultar a la notaría':'Marca para consultar a la notaría'} style={{cursor:'pointer',flexShrink:0,marginTop:2}}>{consOn?<svg width='17' height='17' viewBox='0 0 24 24' fill={C.overdueText} stroke={C.overdueText}><rect x='3' y='3' width='18' height='18' rx='4'/><path d='M8 12l3 3 5-6' stroke='#fff' strokeWidth='2.4' fill='none' strokeLinecap='round' strokeLinejoin='round'/></svg>:<svg width='17' height='17' viewBox='0 0 24 24' fill='none' stroke={C.done} strokeWidth='1.6'><rect x='3' y='3' width='18' height='18' rx='4'/></svg>}</span>}
        {desk&&!chk&&!consChk&&(selK
          ? <span onClick={()=>setDeselNota(p=>{ const n=new Set(p); n.has(r.id)?n.delete(r.id):n.add(r.id); return n })} title={selOn?'Marcada — se importa':'Marca para importar'} style={{cursor:'pointer',marginTop:2,width:16,height:16,borderRadius:5,border:`1.5px solid ${selOn?C.accent:C.done}`,background:selOn?C.accent:'#fff',display:'inline-flex',alignItems:'center',justifyContent:'center'}}>{selOn&&<svg width='10' height='10' viewBox='0 0 24 24' fill='none' stroke='#fff' strokeWidth='3.4' strokeLinecap='round' strokeLinejoin='round'><polyline points='20 6 9 17 4 12'/></svg>}</span>
          : <span/>)}
        {desk&&<div onClick={()=>toggleRowNota(r.id)} style={{cursor:'pointer',paddingTop:1,minWidth:0}}><div style={{fontSize:11.5,fontWeight:700,color:C.accent,fontVariantNumeric:'tabular-nums',whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{otDe(r)}</div><div style={{fontSize:10,color:C.muted,fontVariantNumeric:'tabular-nums'}}>{r.fecha?fmtFDMY(r.fecha):'sin fecha'}</div></div>}
        <div style={{flex:1,minWidth:0}}>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'baseline',gap:8}}>
          <span style={{fontSize:13,fontWeight:700,color:noName&&kind!=='listas'?C.grisText:C.accent,minWidth:0,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{prot}</span>
          {!desk&&<span style={{fontSize:13,fontWeight:700,color:C.text,flexShrink:0,fontVariantNumeric:'tabular-nums'}}>{fmt(r.monto)}</span>}
        </div>
        {sub&&<div style={{fontSize:12,color:C.muted,marginTop:1,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{sub}</div>}
        {/* meta clickeable: OT · fecha · RUT · abogado · ver detalle (mismo comportamiento en TODAS las categorías) */}
        <div onClick={()=>toggleRowNota(r.id)} style={{fontSize:10,color:C.textSoft,marginTop:2,display:'flex',alignItems:'center',gap:6,flexWrap:'wrap',cursor:'pointer',fontVariantNumeric:'tabular-nums'}}>
          <span>{desk?[r.rut?`RUT ${fmtRutCL(r.rut)}`:null,r.abogadoResp||null].filter(Boolean).join(' · '):<>{otDe(r)} · {r.fecha?fmtFDMY(r.fecha):'sin fecha'}{r.rut?` · RUT ${fmtRutCL(r.rut)}`:''}{r.abogadoResp?` · ${r.abogadoResp}`:''}</>}</span>
          {oldY&&<span style={{fontSize:9.5,fontWeight:700,color:C.soonText,background:C.ambarBg,borderRadius:20,padding:'2px 8px',whiteSpace:'nowrap'}}>OT de {fy}</span>}
          <span style={{marginLeft:'auto',color:C.azulInfo,fontWeight:600}}>{open?<>Ocultar detalle{" "}<Gl n='chevU'/></>:<>Ver detalle{" "}<Gl n='chevD'/></>}</span>
        </div>
        {stNote&&<div style={{fontSize:11,fontWeight:600,color:kind==='cambios'?C.soonText:kind==='sinefecto'?C.grisText:st==='pagada'?C.overdueText:st==='rendida'?C.coralText:C.muted,marginTop:3}}>{stNote}</div>}
        {!desk&&extraEl}
        </div>
        {desk&&<span style={{textAlign:'right',fontSize:13,fontWeight:700,color:C.text,fontVariantNumeric:'tabular-nums',whiteSpace:'nowrap',paddingTop:1}}>{fmt(r.monto)}</span>}
        {desk&&<div style={{gridColumn:'2 / 5',minWidth:0}}>{extraEl}</div>}
      </div>
    )
  }
  // Recibo del resultado (clickeable): la acción "Cargar" cuelga del dato; A clientes se despliega.
  const notaReceipt = (cats) => {
    // Se cargan = solo las filas CON destino resuelto (cliente / oficina / miembro), respetando lo desmarcado. Falta y confirma NO se cargan: quedan por revisar.
    const cargarRows=[...cats.proyecto,...cats.listas,...cats.oficina,...cats.personal].filter(notaSelOn)
    const nCarga=cargarRows.length, totCarga=cargarRows.reduce((a,r)=>a+(r.monto||0),0)
    const byCli={}; [...cats.proyecto,...cats.listas].forEach(r=>{ const c=clients.find(x=>String(x.id)===String(r.client_id)); const k=r.client_id; (byCli[k]=byCli[k]||{name:c?.name||'Cliente',n:0,tot:0}); byCli[k].n++; byCli[k].tot+=(r.monto||0) })
    const cliList=Object.values(byCli).sort((a,b)=>b.tot-a.tot)
    const quedan=cats.falta.length+cats.confirma.length
    const sinProy=cargarRows.filter(sinProyNota)
    const respSin=[...new Set(sinProy.map(r=>clients.find(c=>String(c.id)===String(r.client_id))?.abogado_responsable).filter(Boolean))]
    return (
      <div style={{border:`1px solid ${C.border}`,borderRadius:12,overflow:'hidden',background:'#fff',marginTop:14}}>
        <div style={{padding:'8px 13px',fontSize:10,fontWeight:700,textTransform:'uppercase',letterSpacing:.4,color:C.muted,background:C.bgPanel,borderBottom:`.5px solid ${C.track}`}}>Resultado de la carga</div>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'10px 12px',background:C.greenBg,borderBottom:`.5px solid ${C.track}`}}>
          <div><div style={{fontSize:12,color:C.muted}}>Gastos que se cargan</div><div style={{fontSize:17,fontWeight:800,color:C.greenText,letterSpacing:-.3,fontVariantNumeric:'tabular-nums'}}>{nCarga} · {fmt(totCarga)}</div></div>
          <button disabled={guardando||(!nCarga&&!cats.falta.length&&!ajustesNota.length)} onClick={async()=>{ const nPend=cats.falta.length, nAj=ajustesNota.length; if(!nCarga&&!nPend&&!nAj) return
            if(await appConfirm(msgCargaNota(cargarRows,nPend))) guardar(false,[...cargarRows,...cats.falta]) }} style={{fontSize:13,fontWeight:800,border:'none',borderRadius:10,background:C.greenText,color:'#fff',padding:'11px 20px',cursor:(nCarga||cats.falta.length||ajustesNota.length)&&!guardando?'pointer':'default',opacity:(nCarga||cats.falta.length||ajustesNota.length)&&!guardando?1:.5}}>{guardando?'…':'Cargar'}</button>
        </div>
        {sinProy.length>0&&<div onClick={()=>setCatOpen(new Set(['proyecto']))} style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:8,padding:'9px 12px',fontSize:12,color:C.muted,cursor:'pointer',borderBottom:`.5px solid ${C.track}`}}><span>{sinProy.length} OT sin proyecto · se cargan igual{respSin.length?` · aviso a ${respSin.join(', ')}`:''}</span><span style={{fontVariantNumeric:'tabular-nums'}}>{fmt(sinProy.reduce((a,r)=>a+(r.monto||0),0))} <Gl n='chevron'/></span></div>}
        <div style={{fontSize:11,color:C.muted,padding:'8px 13px 0',lineHeight:1.5}}>Tus asignaciones se guardan al Cargar; lo que la app aprende (RUT y clientes) queda para siempre.</div>
        <div style={{fontSize:11,color:C.textSoft,padding:'2px 13px 8px',lineHeight:1.5,borderBottom:`.5px solid ${C.track}`}}>Si algo sale mal, puedes deshacer toda la carga con un clic.</div>
        <div onClick={()=>setRcOpen(o=>!o)} style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'10px 12px',fontSize:13,cursor:'pointer'}}><span style={{color:C.muted}}>Cuánto debe cada cliente <span style={{fontSize:10,color:C.textSoft}}>· de más a menos</span></span><span style={{display:'flex',alignItems:'center',gap:7}}><b>{cliList.length} cliente{cliList.length!==1?'s':''}</b><span style={{color:C.textSoft,transform:rcOpen?'rotate(90deg)':'none',transition:'transform .15s'}}><Gl n='chevron'/></span></span></div>
        {rcOpen&&<div style={{background:C.bgPanel,padding:'2px 13px 9px',maxHeight:240,overflowY:'auto'}}>
          {cliList.map((c,i)=><div key={i} style={{display:'flex',alignItems:'center',gap:8,fontSize:12,padding:'5px 0',borderTop:`.5px dashed ${C.border}`}}><span style={{fontSize:10,fontWeight:700,color:C.textSoft,width:16,flexShrink:0,fontVariantNumeric:'tabular-nums'}}>{i+1}</span><span style={{flex:1,color:C.text,minWidth:0,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{c.name}<span style={{color:C.textSoft}}> · {c.n} OT</span></span><span style={{color:C.accent,fontWeight:700,flexShrink:0,fontVariantNumeric:'tabular-nums'}}>{fmt(c.tot)}</span></div>)}
          {cliList.length>1&&<div style={{display:'flex',justifyContent:'space-between',fontSize:11,fontWeight:700,color:C.muted,padding:'6px 0 0',marginTop:2,borderTop:`1px solid ${C.border}`}}><span>Total a clientes</span><span style={{fontVariantNumeric:'tabular-nums'}}>{fmt(cliList.reduce((a,c)=>a+c.tot,0))}</span></div>}
        </div>}
        <div onClick={()=>setCatOpen(new Set(['falta','confirma']))} style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'10px 12px',fontSize:13,borderTop:`.5px solid ${C.track}`,cursor:'pointer'}}><span style={{color:C.muted}}>Quedan por revisar</span><span style={{display:'flex',alignItems:'center',gap:7}}><b style={{color:C.soonText}}>{quedan}</b><span style={{fontSize:10,color:C.textSoft}}>{cats.falta.length?`${cats.falta.length} sin cliente → pendientes`:''}{cats.falta.length&&cats.confirma.length?' · ':''}{cats.confirma.length?`${cats.confirma.length} por confirmar`:''}</span><span style={{color:C.textSoft}}><Gl n='chevron'/></span></span></div>
      </div>
    )
  }
  // Ventana de revisión notaría: hero (aparte) + 6 tarjetas-categoría + recibo.
  const notaCatsUI = (flt) => {
    const cats=notaCats(flt)
    const iconSq=(k,col,bg)=><span style={{width:36,height:36,borderRadius:10,background:bg,display:'inline-flex',alignItems:'center',justifyContent:'center',flexShrink:0}}>{catSvg(k,col)}</span>
    const filtRows=(rows,k)=>{ const q=(catQ[k]||'').trim().toLowerCase(); if(!q) return rows; const nrm=s=>String(s||'').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,''); const qr=q.replace(/[.\-\s]/g,''); return rows.filter(r=>nrm(nomDe(r)).includes(nrm(q))||nrm(tramDe(r)).includes(nrm(q))||nrm(otDe(r)).includes(nrm(q))||(qr&&String(r.rut||'').replace(/[.\-\s]/g,'').includes(qr))) }
    const buscador=k=><input value={catQ[k]||''} onChange={e=>setCatQ(m=>({...m,[k]:e.target.value}))} placeholder='Buscar por nombre, trámite u OT…' style={{width:'100%',padding:'7px 10px',borderRadius:8,border:`1px solid ${C.border}`,fontSize:12,background:'#fff',color:C.text,outline:'none',boxSizing:'border-box',margin:'2px 0 4px'}}/>
    const card = k => { const meta=CAT_META[k]; const rws=cats[k]; if(!rws.length) return null   // ocultar TODA categoría vacía (antes solo las informativas → "Falta 0"/"Confirma 0" molestaban)
      const open=catOpen.has(k); const tot=k==='cambios' ? rws.reduce((a,r)=>{ const c=cambioNota(r); return a+(c&&c.st==='cargada'?c.ahora-c.antes:0) },0) : rws.reduce((a,r)=>a+(r.monto||0),0); const info=(k==='yacargadas'||k==='sinefecto'||k==='oficina'||k==='nonuestra'||k==='cambios')
      const nSin=cats.falta.filter(r=>!r.client_id&&!r.personal_de&&!r.isInternal&&!r.error&&!r.suggestion).length
      return (
        <div key={k} style={{background:'#fff',border:`1px solid ${k==='falta'&&rws.length?C.overdue:C.border}`,borderRadius:12,overflow:'hidden',marginBottom:9}}>
          <div onClick={()=>toggleCat(k)} style={{display:'flex',alignItems:'center',gap:12,padding:'13px 14px',cursor:'pointer'}}>
            {isDeskCM&&<span style={{color:C.textSoft,fontSize:13,width:10,transform:open?'rotate(90deg)':'none',transition:'transform .15s'}}><Gl n='chevron'/></span>}
            {iconSq(k,meta.col,meta.bg)}
            <div style={{flex:1,minWidth:0}}><div style={{fontSize:15,fontWeight:700,color:C.text,letterSpacing:-.1}}>{meta.t}</div><div style={{fontSize:12,color:C.muted,marginTop:1}}>{meta.s}</div></div>
            {isDeskCM
              ? <div style={{textAlign:'right',flexShrink:0,width:92}}><div style={{fontSize:14,fontWeight:800,color:info?C.muted:C.text,fontVariantNumeric:'tabular-nums',lineHeight:1.1}}>{k==='cambios'&&tot>0?'+':''}{fmt(tot)}</div><div style={{fontSize:10.5,color:meta.col,marginTop:2,fontVariantNumeric:'tabular-nums'}}>{rws.length} OT</div></div>
              : <><div style={{textAlign:'right',flexShrink:0}}><div style={{fontSize:15,fontWeight:800,color:meta.col,fontVariantNumeric:'tabular-nums',lineHeight:1}}>{rws.length}</div>{!info&&<div style={{fontSize:10,color:meta.col,marginTop:2,fontVariantNumeric:'tabular-nums'}}>{fmt(tot)}</div>}</div>
            <span style={{color:C.textSoft,fontSize:13,marginLeft:2,transform:open?'rotate(90deg)':'none',transition:'transform .15s'}}><Gl n='chevron'/></span></>}
          </div>
          {open&&<div style={{borderTop:`1px solid ${C.track}`,padding:'8px 14px 4px'}}>
            {k==='falta'&&(()=>{ const fr=filtRows(rws,k); return (<>
              {nSin>1&&<button disabled={!!driveAll} onClick={buscarTodasDrive} style={{width:'100%',fontSize:12,fontWeight:600,color:C.accent,background:C.azulBg,border:'none',borderRadius:8,padding:'7px',cursor:driveAll?'default':'pointer',marginBottom:4}}>{driveAll?`Buscando en Drive ${driveAll.done}/${driveAll.total}…`:`Buscar las ${nSin} en Drive`}</button>}
              {rws.length>10&&buscador(k)}
              {(()=>{ const noNm=r=>!String(r.nombre||r.requirente||'').replace(/^\s*n\/?a\.?\s*$/i,'').trim(); const by={}; fr.forEach(r=>{ const kk=noNm(r)?'__sindatos__':(((r.nombre||r.requirente||'').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/\s+/g,' ').trim())||('id'+r.id)); (by[kk]=by[kk]||[]).push(r) }); const ents=Object.entries(by).sort((a,b)=> (a[0]==='__sindatos__'?1:0)-(b[0]==='__sindatos__'?1:0) || b[1].length-a[1].length); return ents.map(([kk,g],gi)=> kk==='__sindatos__'
                ? <div key={gi}><div style={{fontSize:11,fontWeight:700,color:C.grisText,padding:'6px 0 2px'}}>Sin datos para identificar <span style={{fontWeight:400,color:C.muted}}>· {g.length} OT · sin compareciente</span></div>{g.map(r=>notaCatRow(r,'falta'))}</div>
                : g.length>1
                ? <div key={gi}><div style={{fontSize:11,fontWeight:700,color:C.accent,padding:'6px 0 2px'}}>{nomDe(g[0])} <span style={{fontWeight:400,color:C.muted}}>· {g.length} OT · {fmt(g.reduce((a,r)=>a+(r.monto||0),0))}</span></div>{g.map(r=>notaCatRow(r,'falta'))}</div>
                : notaCatRow(g[0],'falta')) })()}
            </>)})()}
            {k==='confirma'&&(()=>{ const fr=filtRows(rws,k); const sel=fr.filter(r=>!confDesel.has(r.id)&&r.suggestion); return (<>
              <button disabled={!sel.length} onClick={()=>sel.forEach(r=>asignar(r.id,r.suggestion.id))} style={{width:'100%',fontSize:12,fontWeight:700,color:'#fff',background:sel.length?C.normal:C.done,border:'none',borderRadius:8,padding:'8px',cursor:sel.length?'pointer':'default',marginBottom:2}}>Confirmar seleccionadas ({sel.length})</button>
              {fr.map(r=>notaCatRow(r,'confirma'))}
            </>)})()}
            {(k==='listas'||k==='proyecto')&&(()=>{ const fr=filtRows(rws,k); const by={}; fr.forEach(r=>{ (by[r.client_id]=by[r.client_id]||[]).push(r) }); const groups=Object.entries(by).map(([cid,rs])=>{ const c=clients.find(x=>String(x.id)===String(cid)); let saldo=null; try{ saldo=saldoCliente(expenses,cid) }catch(_){}; const tt=rs.reduce((a,r)=>a+(r.monto||0),0); return {cid,name:c?.name||'Cliente',nEnt:entsOf(cid).length,rs,tt,saldo} }).sort((a,b)=>b.tt-a.tt); return (<>
              {rws.length>10&&buscador(k)}
              {groups.map(g=>{ const cubre=g.saldo!=null&&g.saldo>=g.tt; const adel=g.saldo!=null?Math.max(0,g.tt-g.saldo):0; return (
                <div key={g.cid}>
                  {/* banda de cliente (navy, nombre en blanco): marca el corte entre un cliente y otro */}
                  {isDeskCM ? (()=>{ const selR=g.rs.filter(notaSelOn).length; const allR=g.rs.filter(r=>(r.client_id||r.personal_de)&&!r.error&&!dupInfo[r.id]?.otState); const all=selR>0&&selR===allR.length; return (
                    <div style={{display:'grid',gridTemplateColumns:'16px 76px minmax(0,1fr) 92px',columnGap:10,alignItems:'center',padding:'8px 0',borderTop:`1px solid ${C.border}`,marginTop:4}}>
                      <span onClick={()=>setDeselNota(p=>{ const n=new Set(p); allR.forEach(r=>{ all?n.add(r.id):n.delete(r.id) }); return n })} title={all?'Desmarcar todo el cliente':'Marcar todo el cliente'} style={{cursor:'pointer',width:16,height:16,borderRadius:5,border:`1.5px solid ${selR?C.accent:C.done}`,background:all?C.accent:'#fff',display:'inline-flex',alignItems:'center',justifyContent:'center'}}>{all?<svg width='10' height='10' viewBox='0 0 24 24' fill='none' stroke='#fff' strokeWidth='3.4' strokeLinecap='round' strokeLinejoin='round'><polyline points='20 6 9 17 4 12'/></svg>:selR?<span style={{width:8,height:2,background:C.accent}}/>:null}</span>
                      <span style={{gridColumn:'2 / 4',minWidth:0,fontSize:13,fontWeight:800,color:C.accent,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{g.name}<span style={{fontSize:11,fontWeight:500,color:C.muted}}> · {g.rs.length} OT{selR!==g.rs.length?` · ${selR} de ${g.rs.length} marcadas`:''}</span></span>
                      <span style={{textAlign:'right',fontSize:13,fontWeight:800,color:C.accent,fontVariantNumeric:'tabular-nums'}}>{fmt(g.tt)}</span>
                    </div>) })() : (
                  <div style={{display:'flex',alignItems:'center',gap:8,padding:'8px 11px',background:C.accent,borderRadius:10,margin:'6px 0 8px'}}>
                    <span style={{flex:1,minWidth:0,fontSize:13,fontWeight:800,color:'#fff',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',letterSpacing:-.1}}>{g.name}{g.nEnt>1&&<span style={{fontSize:9.5,fontWeight:700,color:'#CFE3F5',background:'rgba(255,255,255,.16)',borderRadius:20,padding:'2px 8px',marginLeft:6,whiteSpace:'nowrap'}}>{g.nEnt} RS</span>}{g.saldo!=null&&<span style={{fontSize:10,fontWeight:600,color:cubre?'#9FE1CB':'#F3C0C0',marginLeft:6}}>· {cubre?'cubre':`adelanto ${fmt(adel)}`}</span>}</span>
                    <span style={{fontSize:11,color:'#AEC4CE',flexShrink:0,fontVariantNumeric:'tabular-nums',fontWeight:600}}>{g.rs.length} OT · {fmt(g.tt)}</span>
                  </div>
                  )}
                  {g.rs.map(r=>notaCatRow(r,'listas'))}
                </div>
              )})}
            </>)})()}
            {k==='personal'&&(()=>{ const fr=filtRows(rws,k); const by={}; fr.forEach(r=>{ (by[r.personal_de||'—']=by[r.personal_de||'—']||[]).push(r) }); return Object.entries(by).sort((a,b)=>b[1].reduce((s,r)=>s+(r.monto||0),0)-a[1].reduce((s,r)=>s+(r.monto||0),0)).map(([pers,rs])=>{ const pc=personChip(pers); const tt=rs.reduce((a,r)=>a+(r.monto||0),0); return (
              <div key={pers}>
                <div style={{display:'flex',alignItems:'center',gap:7,padding:'8px 0 4px'}}><span style={{width:7,height:7,borderRadius:'50%',background:pc.color,flexShrink:0}}/><span style={{flex:1,fontSize:13,fontWeight:800,color:pc.color}}>{pers}</span><span style={{fontSize:11,color:C.muted,fontVariantNumeric:'tabular-nums'}}>{rs.length} OT · {fmt(tt)}</span></div>
                {rs.map(r=>notaCatRow(r,'personal'))}
              </div>
            )}) })()}
            {k==='oficina'&&filtRows(rws,k).map(r=>notaCatRow(r,'oficina'))}
            {k==='nonuestra'&&(()=>{ const noNs=rws; const selRows=noNs.filter(r=>notaConsultaSel.has(r.id)); const allOn=selRows.length===noNs.length&&noNs.length>0; return (
              <div style={{display:'flex',alignItems:'center',gap:8,flexWrap:'wrap',padding:'2px 0 8px',marginBottom:2,borderBottom:`.5px solid ${C.track}`}}>
                <button onClick={()=>setNotaConsultaSel(allOn?new Set():new Set(noNs.map(r=>r.id)))} style={{fontSize:11,fontWeight:600,color:C.accent,background:'none',border:'none',cursor:'pointer',padding:0}}>{allOn?'Ninguna':`Seleccionar todas (${noNs.length})`}</button>
                <button disabled={consultando||!selRows.length} onClick={()=>consultarNotaria(selRows)} style={{marginLeft:'auto',fontSize:12,fontWeight:700,color:'#fff',background:selRows.length?C.overdue:C.done,border:'none',borderRadius:8,padding:'6px 12px',cursor:selRows.length&&!consultando?'pointer':'default',opacity:selRows.length&&!consultando?1:.6,display:'inline-flex',alignItems:'center',gap:6}}><svg width='13' height='13' viewBox='0 0 24 24' fill='none' stroke='#fff' strokeWidth='2' strokeLinecap='round' strokeLinejoin='round'><line x1='22' y1='2' x2='11' y2='13'/><polygon points='22 2 15 22 11 13 2 9 22 2'/></svg>{consultando?'Enviando…':`Consultar a la notaría (${selRows.length})`}</button>
              </div>
            )})()}
            {(k==='yacargadas'||k==='sinefecto'||k==='errores'||k==='nonuestra'||k==='cambios')&&rws.map(r=>notaCatRow(r,k))}
          </div>}
        </div>
      )
    }
    return (<div>
      {/* Guía de una línea (qué hacer) — baja la curva de la primera vez */}
      {notaria&&readyBanner&&!matching&&<div style={{display:'flex',alignItems:'center',gap:10,background:C.greenBg,border:`1px solid ${C.normal}`,borderRadius:12,padding:'10px 12px',marginBottom:9}}>
        <span style={{width:26,height:26,borderRadius:'50%',background:'#fff',display:'inline-flex',alignItems:'center',justifyContent:'center',flexShrink:0}}><svg width='15' height='15' viewBox='0 0 24 24' fill='none' stroke={C.greenText} strokeWidth='2.6'><path d='M5 13l4 4L19 7'/></svg></span>
        <div style={{flex:1,minWidth:0}}><div style={{fontSize:13,fontWeight:700,color:C.greenText}}>Análisis listo · ya puedes revisar y trabajar la carga</div><div style={{fontSize:11,color:C.muted,marginTop:1}}>Revisa por categoría abajo y confirma con Cargar.</div></div>
        <button onClick={()=>setReadyBanner(false)} style={{fontSize:16,color:C.textSoft,background:'none',border:'none',cursor:'pointer',flexShrink:0,lineHeight:1,padding:0}}><Gl n='x'/></button>
      </div>}
      {notaria&&(()=>{ const cts=notaCats(rows||[]); const nLeidas=(rows||[]).length; const errs=cts.errores
        // Partición única (suman las filas del archivo): se cargan = con destino (cliente/oficina/miembro); por revisar = falta+confirma; ya en la app; anuladas; con error.
        const nDest=cts.listas.length+cts.proyecto.length+cts.oficina.length+cts.personal.length; const nRev=cts.falta.length+cts.confirma.length; const nYa=cts.yacargadas.length; const nAnul=cts.sinefecto.length; const nNoN=cts.nonuestra.length; const nCamb=cts.cambios.length; return (
        <div style={{background:'#fff',border:`1px solid ${C.border}`,borderRadius:12,padding:'10px 12px',marginBottom:9}}>
          <div style={{display:'flex',gap:14,flexWrap:'wrap',alignItems:'baseline'}}>
            <div><span style={{fontSize:20,fontWeight:800,color:C.accent,fontVariantNumeric:'tabular-nums'}}>{nLeidas}</span> <span style={{fontSize:11,color:C.muted}}>filas del archivo</span></div>
            <div><span style={{fontSize:16,fontWeight:800,color:C.greenText,fontVariantNumeric:'tabular-nums'}}>{nDest}</span> <span style={{fontSize:11,color:C.muted}}>se cargan</span></div>
            {nRev>0&&<div><span style={{fontSize:16,fontWeight:800,color:C.soonText,fontVariantNumeric:'tabular-nums'}}>{nRev}</span> <span style={{fontSize:11,color:C.muted}}>por revisar</span></div>}
            {nYa>0&&<div><span style={{fontSize:16,fontWeight:800,color:C.textSoft,fontVariantNumeric:'tabular-nums'}}>{nYa}</span> <span style={{fontSize:11,color:C.muted}}>ya en la app</span></div>}
            {nCamb>0&&<div onClick={()=>setCatOpen(new Set(['cambios']))} title='Ver los cambios' style={{cursor:'pointer'}}><span style={{fontSize:16,fontWeight:800,color:C.soonText,fontVariantNumeric:'tabular-nums'}}>{nCamb}</span> <span style={{fontSize:11,color:C.muted,textDecoration:'underline',textDecorationColor:C.border,textUnderlineOffset:3}}>cambios de la notaría</span></div>}
            {nNoN>0&&<div><span style={{fontSize:16,fontWeight:800,color:C.overdueText,fontVariantNumeric:'tabular-nums'}}>{nNoN}</span> <span style={{fontSize:11,color:C.muted}}>no son nuestras</span></div>}
            {nAnul>0&&<div><span style={{fontSize:16,fontWeight:800,color:C.grisText,fontVariantNumeric:'tabular-nums'}}>{nAnul}</span> <span style={{fontSize:11,color:C.muted}}>sin efecto o de registro</span></div>}
            {errs.length>0&&<div><span style={{fontSize:16,fontWeight:800,color:C.overdueText,fontVariantNumeric:'tabular-nums'}}>{errs.length}</span> <span style={{fontSize:11,color:C.muted}}>con error</span></div>}
          </div>
          {errs.some(r=>/OT no detectada/i.test(r.error||''))&&<div style={{marginTop:8,background:C.overdueBg,border:'1px solid #F3C9C4',borderRadius:8,padding:'8px 11px',fontSize:12,color:C.overdueText,fontWeight:600,lineHeight:1.5}}>La app <b>releyó estas filas</b> y aun así no encontró la OT. Todo trabajo de notaría trae OT → revisa que la columna <b>OT</b> del archivo esté presente y completa en esas filas. No se cargan sin OT.</div>}
          {errs.length>0&&<details style={{marginTop:8}}>
            <summary style={{fontSize:11,color:C.overdueText,fontWeight:700,cursor:'pointer',listStyle:'none'}}>Ver las {errs.length} con error <Gl n='chevron'/></summary>
            <div style={{marginTop:6,maxHeight:180,overflowY:'auto',border:`1px solid ${C.border}`,borderRadius:8}}>
              {errs.map(r=><div key={r.id} style={{display:'flex',justifyContent:'space-between',gap:8,padding:'6px 9px',fontSize:11,borderTop:`1px solid ${C.bgSoft}`}}><span style={{minWidth:0,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',color:C.text}}>{otDe(r)?`OT ${otDe(r)} · `:''}{r.nombre||r.requirente||r.concepto||'—'}</span><span style={{color:C.overdueText,flexShrink:0,fontWeight:600}}>{r.error}</span></div>)}
            </div>
          </details>}
        </div>
      )})()}
      <div style={{fontSize:11,color:C.muted,background:C.bgPanel,border:`1px solid ${C.border}`,borderRadius:10,padding:'8px 11px',marginBottom:9,lineHeight:1.5}}>Revisa por categoría → asigna lo que falte (cliente · Drive · gasto interno) → <b style={{color:C.accent}}>Cargar</b>. Nada se guarda hasta que confirmas.</div>
      {aprendido&&aprendido.name
        ? <div style={{display:'flex',alignItems:'center',gap:7,background:C.greenBg,border:`1px solid ${C.normal}`,borderRadius:10,padding:'8px 11px',marginBottom:9}}><svg width='15' height='15' viewBox='0 0 24 24' fill='none' stroke={C.greenText} strokeWidth='2.4'><path d='M5 13l4 4L19 7'/></svg><span style={{fontSize:12,color:C.greenText}}>Aprendí que <b>{aprendido.name}</b> es <b>{aprendido.cli}</b> — no te lo vuelvo a preguntar.</span></div>
        : accionMsg&&<div style={{display:'flex',alignItems:'center',gap:7,background:C.bgSoft,border:`1px solid ${C.border}`,borderRadius:10,padding:'8px 11px',marginBottom:9}}><svg width='14' height='14' viewBox='0 0 24 24' fill='none' stroke={C.greenText} strokeWidth='2.4'><path d='M5 13l4 4L19 7'/></svg><span style={{fontSize:12,color:C.text}}>{accionMsg}</span></div>}
      {['errores','cambios','falta','confirma','proyecto','listas','personal','oficina','yacargadas','nonuestra','sinefecto'].map(card)}
      {notaReceipt(cats)}
    </div>)
  }

  // Notaría: lo ya cargado se AJUSTA al dato de la notaría (N° de OT a un gasto que estaba sin número; monto si aún no se paga ni rinde).
  const ajustesNota = notaria ? (rows||[]).flatMap(r=>{ const d=dupInfo[r.id]; if(!d) return []
    if(d.sinNum) return [{id:d.sinNum.id, ot_number:String(r.ot||'').trim()}]
    const cmb=cambioNota(r)
    if(cmb&&cmb.st==='cargada') return [{id:d.otDup.id, amount:cmb.ahora, motivo:cmb.sinCobro?(/de registro/i.test(r.error||'')?'La notaría la cobra $1 (de registro): no es gasto':'La notaría la dejó sin efecto: no se cobra'):`La notaría cambió el monto de ${fmt(cmb.antes)} a ${fmt(cmb.ahora)}`}]
    return [] }) : []
  // Confirmación ÚNICA de la carga de notaría (botón Cargar e Importar seleccionadas): dice qué se carga, qué se ajusta (y cuánto) y qué solo se avisa.
  const msgCargaNota = (aCargar, nPend=0) => {
    const nC=aCargar.length, tot=aCargar.reduce((a,r)=>a+(r.monto||0),0), nCli=new Set(aCargar.map(r=>r.client_id).filter(Boolean)).size
    const cmbs=(rows||[]).map(cambioNota).filter(Boolean), aj=cmbs.filter(c=>c.st==='cargada'), aviso=cmbs.length-aj.length
    const neto=aj.reduce((a,c)=>a+c.ahora-c.antes,0), nCero=aj.filter(c=>c.ahora===0).length, nNum=ajustesNota.filter(a=>a.ot_number).length
    const nYa=(rows||[]).filter(r=>dupInfo[r.id]?.otState&&!cambioNota(r)).length-nNum
    const fila=(l,v,col,sub)=>(<div key={l} style={{display:'flex',justifyContent:'space-between',gap:12,padding:'5px 0',borderTop:`1px solid ${C.bgSoft}`,paddingLeft:sub?14:0}}><span style={{color:sub?C.muted:C.text,fontSize:sub?13:14,whiteSpace:'nowrap'}}>{l}</span><span style={{fontWeight:700,color:col||C.text,fontVariantNumeric:'tabular-nums',whiteSpace:'nowrap'}}>{v}</span></div>)
    const message=(<div style={{whiteSpace:'normal'}}>
      {nC>0&&fila('OT nuevas',`${nC} · ${fmt(tot)}`)}
      {aj.length>0&&fila('Ajustes de la notaría',`${aj.length} · ${neto>0?'+':''}${fmt(neto)}`,C.soonText)}
      {nCero>0&&fila('quedan en $0',nCero,C.muted,true)}
      {nNum>0&&fila('Reciben su N° de OT',nNum)}
      {aviso>0&&fila('Pagadas con diferencia',`${aviso} · revisar`,C.overdueText)}
      {nPend>0&&fila('Por identificar',nPend)}
      {nYa>0&&fila('Ya en la app · se omiten',nYa,C.muted)}
    </div>)
    return {title:'Cargar liquidación de la notaría', message, confirmText:'Cargar'}
  }
  const guardar = async(incluirTodo=false, explicit=null) => {
    const target0 = explicit || (incluirTodo ? (rows||[]) : listas)
    if(target0.length===0 && notaria && ajustesNota.length){ setGuardando(true)
      try{ const n=onAjustarNotaria?await onAjustarNotaria(ajustesNota,{filename:fileName}):0; setResultado({imported:0,dupOmit:0,ajustados:n,nota:{porPagar:0,clientes:0},leidas:(rows||[]).length,errores:(rows||[]).filter(r=>r.error).length,erroresDet:[],omitidas:(rows||[]).filter(r=>dupInfo[r.id]?.otState).length,pendientes:0}) }catch(e){ appAlert('Error al ajustar: '+(e.message||e)) }
      setGuardando(false); return }
    if(target0.length===0){ appAlert(incluirTodo?'No hay filas para cargar.':'No hay filas listas para cargar (con cliente y razón social resueltos, sin errores).'); return }
    // Proyecto: se guarda el resuelto y se aprende el elegido por sociedad. Nunca frena la carga: lo que quede sin proyecto se asigna en el gasto.
    const vistosP=new Set()
    const target = target0.map(r=>{ const pr=proyDe(r)
      if(r.sale_id&&!DEMO){ const k=proyKey(r); if(k&&!vistosP.has(k)&&String(notaProyL[k]||'')!==String(r.sale_id)){ vistosP.add(k); learnPut('notaria_proyecto',k,r.sale_id) } }
      return pr.sale&&!r.sale_id?{...r,sale_id:pr.sale}:r })
    setGuardando(true)
    try{
      // Notaría: arma el resumen de estado (cargadas + con error + ya en la app) ANTES de importar, para persistirlo con la carga (nada sin rastro).
      let notaResumen=null
      // Pendientes por identificar = filas del target sin cliente ni miembro (se cargan como gasto sin cliente → van a la alarma de +3 días).
      const pendRows = target.filter(r=>!r.client_id&&!r.personal_de&&!r.error)
      const pagadores = target.filter(r=>(r.client_id||r.personal_de)&&!r.error)
      if(notaria){ const errRows=(rows||[]).filter(r=>r.error); const omitidas=(rows||[]).filter(r=>dupInfo[r.id]?.otState).length; const noNs=(rows||[]).filter(r=>r.noNuestra)
        notaResumen={ leidas:(rows||[]).length, cargadas:pagadores.length, pendientes:pendRows.length, error:errRows.length, omitidas, erroresDet:errRows.map(r=>({ot:otDe(r),nombre:r.nombre||r.requirente||r.concepto||'—',motivo:r.error})), noNuestras:noNs.map(r=>({ot:otDe(r),nombre:r.nombre||r.requirente||r.concepto||'—',monto:r.monto||0,motivo:r.materia||'',fecha:_fechaISO(r.fecha),materia:r.materia||null,requirente:r.requirente||null,concepto:r.concepto||null,subconcepto:r.subconcepto||null})) } }
      const ajN = (notaria&&ajustesNota.length&&onAjustarNotaria) ? await onAjustarNotaria(ajustesNota,{filename:fileName}) : 0
      const res = await onBulkImport(target, {tipo, filename:fileName, notaResumen})
      // Notaría: resumen REAL de lo cargado (usa lo efectivamente insertado tras dedup, no la intención pre-carga).
      if(notaria){ const conCli=pagadores.filter(r=>r.client_id&&!r.personal_de&&!esOficinaCli(r.client_id)); const porPagar=target.reduce((a,r)=>a+(r.monto||0),0); const clientes=new Set(conCli.map(r=>String(r.client_id))).size
        setResultado({...res, ajustados:ajN, imported:res.cargadas??pagadores.length, nota:{porPagar,clientes}, leidas:notaResumen.leidas, errores:notaResumen.error, erroresDet:notaResumen.erroresDet, omitidas:notaResumen.omitidas, pendientes:res.pendientes??pendRows.length}) }
      else setResultado(res)
    }catch(e){ appAlert('Error al importar: '+(e.message||e)) }
    setGuardando(false)
  }
  // Exporta la carga a CSV (para la notaría / Martina / contador): OT, fecha, compareciente, trámite, cliente, monto, estado.
  const exportarCargaCSV = () => {
    const cn=r=>r.client_id?(clients.find(c=>String(c.id)===String(r.client_id))?.name||r.clientName||''):(r.personal_de?`Personal · ${r.personal_de}`:'')
    const estadoRow=r=> r.error?(/de registro/i.test(r.error)?'De registro':'Anulada') : (dupInfo[r.id]?.otState||dupInfo[r.id]?.sinNum)?'Ya en la app' : (r.client_id?'A cliente':(r.suggestion?'Sugerida':'Sin cliente'))
    const esc=s=>`"${String(s==null?'':s).replace(/"/g,'""')}"`
    const head=['OT','Fecha','Compareciente','Tramite','Cliente','Monto','Estado']
    const body=(rows||[]).map(r=>[otDe(r), r.fecha||'', r.nombre||r.requirente||'', r.materia||'', cn(r), r.monto||0, estadoRow(r)])
    const csv=[head,...body].map(row=>row.map(esc).join(',')).join('\n')
    const blob=new Blob(['﻿'+csv],{type:'text/csv;charset=utf-8'}); const url=URL.createObjectURL(blob); const a=document.createElement('a'); a.href=url; a.download=`carga_notaria_${new Date().toISOString().slice(0,10)}.csv`; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url)
  }

  // Conciliación: calza cada fila con un gasto existente (por OT, si no por fecha+monto+glosa). Lo que calza se ACTUALIZA; el resto se IMPORTA.
  const concil = useMemo(()=>{
    if(modo!=='conciliar' || !rows) return null
    const normOt = s=>String(s||'').replace(/\D/g,'')
    const tok = s=>new Set(String(s||'').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'').split(/[^a-z0-9]+/).filter(w=>w.length>2))
    const ov = (a,b)=>{ let n=0; a.forEach(w=>{ if(b.has(w)) n++ }); return n }
    const live = (expenses||[]).filter(e=>!e.deleted_at && (tipo==='fondo'?e.type==='fondo':e.type!=='fondo'))
    const byOt = {}; live.forEach(e=>{ const o=normOt(e.ot_number); if(o){(byOt[o]=byOt[o]||[]).push(e)} })
    const used = new Set(); const actualizar=[], nuevos=[]
    // Devuelve {g:gasto, via:'ot'|'fecha'|'cliente', score:palabrasGlosa} o null.
    const pick = r=>{
      if(concilMatch[r.id]){ const g=live.find(e=>!used.has(e.id)&&String(e.id)===String(concilMatch[r.id])); if(g) return {g,via:'manual'} }
      const o=normOt(r.ot); if(o&&byOt[o]){ const c=byOt[o].find(e=>!used.has(e.id)); if(c) return {g:c,via:'ot'} }
      if(r.fecha){ let cands = live.filter(e=>!used.has(e.id) && (e.amount||0)===(r.monto||0) && String(e.date||'')===String(r.fecha||''))
        // Fecha+monto solo calza dentro del MISMO cliente, nunca cruzado: el 25-06-2026 la caja chica de Martina
        // (Hugo Figueroa, CBR $8.000 del 10-04) se pegó a la OT 448251 de Juan Pablo Mir (misma fecha y monto) y el
        // gasto de Hugo nunca se creó. Tampoco calza una fila sin OT con un gasto que sí tiene OT, ni una caja chica
        // con un gasto ya pagado a la notaría (ese lo pagó la oficina, no la caja).
        if(r.client_id){ cands=cands.filter(e=>!e.client_id||String(e.client_id)===String(r.client_id)); const sc=cands.filter(e=>e.client_id); if(sc.length) cands=sc }   // un gasto aún sin cliente sí puede ser el mismo
        if(!normOt(r.ot)) cands=cands.filter(e=>!normOt(e.ot_number))
        if(cajaReasigna) cands=cands.filter(e=>!e.notaria_liquidado_at&&!e.notaria_render_id)
        if(cands.length===1) return {g:cands[0],via:'fecha'}
        if(cands.length>1){ const rt=tok(r.concepto); let best=cands[0],bn=-1; cands.forEach(e=>{ const n=ov(tok(e.concept),rt); if(n>bn){bn=n;best=e} }); return {g:best,via:'fecha',score:bn} } }
      // Sin OT ni fecha que calce (históricos sin fecha): cliente + monto + glosa (≥1 palabra en común).
      if(r.client_id){ const cm=live.filter(e=>!used.has(e.id) && (e.amount||0)===(r.monto||0) && String(e.client_id||'')===String(r.client_id)); if(cm.length){ const rt=tok(r.concepto); let best=null,bn=-1; cm.forEach(e=>{ const n=ov(tok(e.concept),rt); if(n>bn){bn=n;best=e} }); if(bn>=1) return {g:best,via:'cliente',score:bn} } }
      return null
    }
    ;(rows||[]).filter(r=>!r.error&&(r.monto||0)>0).forEach(r=>{ if(forzarNuevo.has(r.id)){ nuevos.push(r); return } const m=pick(r); if(m){ used.add(m.g.id); actualizar.push({r,e:m.g,rendido:!!(m.g.render_id||m.g.client_render_id),via:m.via,score:m.score}) } else nuevos.push(r) })
    // ¿Esta actualización CAMBIA algo? Si el gasto ya tiene el cliente/RS/categoría del archivo, no hay nada que corregir.
    const cambia = ({r,e,rendido})=>{
      if(cajaReasigna && !rendido && !e.rendered_at && String(e.created_by||'')!==String(cajaReasigna)) return true   // re-asignar a la caja chica elegida (nunca un gasto ya rendido o liquidado)
      if(r.paid_by_client!==undefined && Boolean(e.paid_by_client)!==Boolean(r.paid_by_client)) return true   // aplicar la columna "Caja chica sí/no"
      const newCat = tipo==='fondo'?'Fondo':(r.categoria||e.category)
      if(String(e.category||'')!==String(newCat||'')) return true
      if(rendido&&noTocarRendidos) return false   // protegido: solo se tocaría la categoría (ya igual ⇒ sin cambios)
      if(String(e.client_id||'')!==String(r.client_id||e.client_id||'')) return true
      if(String(e.entity_id||'')!==String(r.entity_id||'')) return true
      return false
    }
    let corregir = actualizar.filter(cambia)
    let yaCorrecto = actualizar.filter(a=>!cambia(a))
    // CONSISTENCIA con el anti-duplicados del import (mismo keyOf exacto): un "nuevo" idéntico a uno
    // que ya existe se reclasifica a "Ya cargados" (no se importa); un duplicado dentro del archivo se
    // cuenta una sola vez. Así el conteo del preview = lo que realmente importa (regla: consistencia).
    const composed = r=>{ const s=(r.subconcepto||'').trim(), b=(r.concepto||'').trim(); return (!r.conceptoFix&&s&&!b.toLowerCase().includes(s.toLowerCase()))?`${b} — ${s}`:b }
    const keyEx = e=>`${e.client_id||''}|${e.amount||0}|${e.date||''}|${(e.concept||'').trim().toLowerCase()}|${(e.subconcept||'').trim().toLowerCase()}|${(e.ot_number||'').trim().toLowerCase()}`
    const keyRow = r=>`${r.client_id||''}|${r.monto||0}|${r.fecha||''}|${composed(r).trim().toLowerCase()}|${(r.subconcepto||'').trim().toLowerCase()}|${(r.ot||'').trim().toLowerCase()}`
    const usedEx=new Set(), seenK=new Set(), nuevosK=[]
    nuevos.forEach(r=>{ const k=keyRow(r); const ex=live.find(e=>!used.has(e.id)&&!usedEx.has(e.id)&&keyEx(e)===k); if(ex){ usedEx.add(ex.id); const it={r,e:ex,rendido:!!(ex.render_id||ex.client_render_id)}; if(cambia(it)) corregir=[...corregir,it]; else yaCorrecto=[...yaCorrecto,it] } else if(seenK.has(k)){ /* duplicado dentro del archivo: el import lo omite, acá no se cuenta */ } else { seenK.add(k); nuevosK.push(r) } })
    // Posibles duplicados: un "nuevo" CON cliente que tiene un gasto de mismo cliente+monto en el sistema
    // (no calzó fuerte porque glosa/fecha difieren). Orden: cliente → monto → descripción.
    const posibles=[], nuevosLimpios=[]
    nuevosK.forEach(r=>{ if(!r.client_id){ nuevosLimpios.push(r); return } const near=live.find(e=>!used.has(e.id)&&!usedEx.has(e.id)&&(e.amount||0)===(r.monto||0)&&String(e.client_id||'')===String(r.client_id)); if(near) posibles.push({r,e:near}); else nuevosLimpios.push(r) })
    return {actualizar, corregir, yaCorrecto, nuevos:nuevosLimpios, posibles, rendidosN: actualizar.filter(a=>a.rendido).length}
  },[modo,rows,expenses,tipo,noTocarRendidos,concilMatch,forzarNuevo,cajaReasigna])
  // Lo realmente seleccionado (las filas que el usuario dejó tildadas). Clave: c_<gastoId> / n_<rowId>.
  const corregirSel = () => (concil?.corregir||[]).filter(a=>!concilExcl.has('c_'+a.e.id))
  const nuevosSel = () => [...(concil?.nuevos||[]).filter(r=>!concilExcl.has('n_'+r.id)), ...(concil?.posibles||[]).filter(p=>posibleDec[p.r.id]==='cargar').map(p=>p.r)]
  const posiblesPend = () => (concil?.posibles||[]).filter(p=>!posibleDec[p.r.id]).length   // posibles aún por decidir
  useEffect(()=>{ if(!rows||modo!=='conciliar') return; try{ const m={}; Object.entries(concilMatch).forEach(([rid,gid])=>{ const r=rows.find(x=>String(x.id)===String(rid)); if(r&&gid) m[rowKeyHuella(r)]=gid }); const f=[]; forzarNuevo.forEach(rid=>{ const r=rows.find(x=>String(x.id)===String(rid)); if(r) f.push(rowKeyHuella(r)) }); const pd={}; Object.entries(posibleDec).forEach(([rid,dec])=>{ const r=rows.find(x=>String(x.id)===String(rid)); if(r&&dec) pd[rowKeyHuella(r)]=dec }); localStorage.setItem('carga_dec_v1',JSON.stringify({match:m,forzar:f,posdec:pd})) }catch(_){} },[concilMatch,forzarNuevo,posibleDec,rows,modo])
  const [concilBefore,setConcilBefore] = useState(null)
  const aplicarConcil = async()=>{
    if(!concil) return
    setGuardando(true)
    try{
      const actualizaciones = concil.actualizar.map(({r,e,rendido})=>{
        const a={id:e.id, category:(tipo==='fondo'?'Fondo':(r.categoria||e.category))}
        if(!(rendido&&noTocarRendidos)){ a.client_id=r.client_id||e.client_id; a.entity_id=r.entity_id||null }
        return a
      })
      const res = await onConciliar(actualizaciones, concil.nuevos, {tipo, filename:fileName})
      setConcilBefore(res.before||null)
      setResultado({concil:true, actualizados:res.actualizados, imported:res.importados, batchId:res.batchId})
    }catch(e){ appAlert('Error al conciliar: '+(e.message||e)) }
    setGuardando(false)
  }
  // Acciones separadas (el usuario las hace por partes; volver a subir el archivo retoma sin duplicar).
  const aplicarCorregir = async()=>{
    const sel=corregirSel(); if(!sel.length) return
    setGuardando(true)
    try{
      const actualizaciones = sel.map(({r,e,rendido})=>{ const a={id:e.id, category:(tipo==='fondo'?'Fondo':(r.categoria||e.category))}; if(!(rendido&&noTocarRendidos)){ a.client_id=r.client_id||e.client_id; a.entity_id=r.entity_id||null } if(cajaReasigna && !rendido && !e.rendered_at) a.created_by=cajaReasigna; if(r.paid_by_client!==undefined) a.paid_by_client=r.paid_by_client; return a })
      const res = await onConciliar(actualizaciones, [], {tipo, filename:fileName})
      setConcilBefore(res.before||null)
      setResultado(prev=>({...(prev||{}), concil:true, actualizados:res.actualizados, imported:prev?.imported||0, batchId:prev?.batchId||null, corregirDone:true, nuevosPend:nuevosSel().length}))
    }catch(e){ appAlert('Error al corregir: '+(e.message||e)) }
    setGuardando(false)
  }
  const aplicarImportar = async()=>{
    const sel=nuevosSel(); if(!sel.length) return
    setGuardando(true)
    try{
      const res = await onConciliar([], sel, {tipo, filename:fileName, cajaOwner:cajaOwner||null})
      setResultado(prev=>({...(prev||{}), concil:true, imported:res.importados, omitidos:res.omitidos||0, actualizados:prev?.actualizados||0, batchId:res.batchId, importarDone:true, actualizarPend:(prev?.corregirDone?0:corregirSel().length)}))
    }catch(e){ appAlert('Error al importar: '+(e.message||e)) }
    setGuardando(false)
  }

  const inS = {padding:'7px 8px',borderRadius:6,border:`1px solid ${C.border}`,fontSize:12,background:C.bgSoft,color:C.text,boxSizing:'border-box',outline:'none',width:'100%'}

  // Pieza 5a: aviso a los socios tras la carga de notaría (resumen + alarmas). Cifras al final, con total. Compuerta: lo envías tú.
  const [avisadoSocios,setAvisadoSocios] = useState(false)
  const avisarSocios = async () => {
    const conCli=(rows||[]).filter(r=>r.client_id||r.personal_de).length
    const sinCli=(rows||[]).filter(r=>!r.error&&!r.client_id&&!r.personal_de).length
    const nImp=resultado?.imported||resultado?.actualizados||0
    const al=(rows||[]).filter(r=>['pagada','rendida'].includes(dupInfo[r.id]?.otState)).map(r=>{ const e=dupInfo[r.id].otDup, st=dupInfo[r.id].otState; const otL=String(r.ot).toUpperCase().startsWith('OT')?String(r.ot).toUpperCase():'OT-'+r.ot; const cn=e.client_id?(clients.find(c=>String(c.id)===String(e.client_id))?.name||'cliente'):'cliente'; return {otL,st,cn,monto:r.monto||0} })
    const totAl=al.reduce((a,x)=>a+x.monto,0)
    const li=(t,m)=>`<div style="display:flex;justify-content:space-between;gap:10px;padding:4px 0;border-top:1px solid #E4E8EB;font-size:12px"><span>${t}</span><span style="font-weight:700;color:#003C50;white-space:nowrap">${m}</span></div>`
    const alarmasHtml = al.length ? `<div style="margin-top:14px"><b style="color:#9A3A24">Alarmas — estas OT no se cargaron, revísalas:</b>${al.map(x=>li(`${x.otL} · ya ${x.st==='pagada'?'pagada a la notaría':'rendida a '+x.cn}`, '$'+x.monto.toLocaleString('es-CL'))).join('')}${li('<b>Total en alarma</b>','<b>$'+totAl.toLocaleString('es-CL')+'</b>')}</div>` : ''
    const html=`<div style="font-family:Arial,Helvetica,sans-serif;color:#26333A;font-size:13px;line-height:1.6">Hola,<br><br>Cargué <b>${nImp}</b> OT${nImp!==1?'s':''} de la notaría.${li('Con cliente identificado','<b>'+conCli+'</b>')}${li('Por asignar','<b>'+sinCli+'</b>')}${alarmasHtml}<br>Saludos.</div>`
    const socios=await cargarAdminsEstudio(); const sociosTo=socios.map(x=>x.email).filter(Boolean).join(', ')||'cl@leabogados.cl, ee@leabogados.cl'
    if(!await appConfirm(`¿Avisar a los socios (${socios.map(x=>x.nombre).join(' y ')||'Cristóbal y Erasmo'}) el resumen de esta carga${al.length?` y las ${al.length} alarma${al.length!==1?'s':''}`:''}?`)) return
    try{ const via=await enviarComoUsuario({to:sociosTo, subject:`Carga de notaría — ${nImp} OT${nImp!==1?'s':''}${al.length?` · ${al.length} alarma${al.length!==1?'s':''}`:''}`, html, text:`Cargué ${nImp} OTs de la notaría.${al.length?` ${al.length} alarmas detectadas.`:''}`}); if(via){ setAvisadoSocios(true); appAlert(txtEnviado(via,{que:'Aviso',para:'los socios'})) } }catch(e){ appAlert('No se pudo enviar el aviso: '+(e.message||e)) }
  }

  if(resultado) return (
    <div style={{textAlign:'center',padding:'8px 4px 4px'}}>
      <div style={{width:54,height:54,borderRadius:'50%',background:C.greenBg,display:'flex',alignItems:'center',justifyContent:'center',margin:'4px auto 12px'}}>
        <svg width='27' height='27' viewBox='0 0 24 24' fill='none' stroke='#1D9E75' strokeWidth='2.4' strokeLinecap='round' strokeLinejoin='round'><polyline points='20 6 9 17 4 12'/></svg>
      </div>
      <div style={{fontSize:17,fontWeight:600,color:C.text,marginBottom:resultado.omitidos>0?6:12,fontFamily:"'DM Sans',sans-serif"}}>{resultado.concil?`${resultado.actualizados} corregido(s) · ${resultado.imported} nuevo(s)`:notaria?`${resultado.imported} OT cargada${resultado.imported!==1?'s':''}${resultado.sinCliente>0?` · ${resultado.imported-resultado.sinCliente} a clientes`:''}`:`${resultado.imported} ${tipo==='fondo'?'fondo(s)':'gasto(s)'} importado(s)`}</div>
      {notaria&&<div style={{display:'flex',flexWrap:'wrap',gap:7,justifyContent:'center',marginBottom:resultado.errores>0?8:12}}>
        <span style={{fontSize:12,fontWeight:700,color:C.greenText,background:C.greenBg,borderRadius:20,padding:'4px 11px'}}>{resultado.imported||0} cargadas</span>
        {resultado.pendientes>0&&<span style={{fontSize:12,fontWeight:700,color:C.soonText,background:C.soonBg,borderRadius:20,padding:'4px 11px'}}>{resultado.pendientes} pendientes por identificar</span>}
        {resultado.omitidas>0&&<span style={{fontSize:12,fontWeight:700,color:C.textSoft,background:C.bgSoft,borderRadius:20,padding:'4px 11px'}}>{resultado.omitidas} ya en la app</span>}
        {resultado.ajustados>0&&<span style={{fontSize:12,fontWeight:700,color:C.greenText,background:C.greenBg,borderRadius:20,padding:'4px 11px'}}>{resultado.ajustados} actualizada{resultado.ajustados!==1?'s':''} con el dato de la notaría</span>}
        {resultado.errores>0&&<span style={{fontSize:12,fontWeight:700,color:C.overdueText,background:C.overdueBg,borderRadius:20,padding:'4px 11px'}}>{resultado.errores} con error · no cargadas</span>}
      </div>}
      {notaria&&resultado.pendientes>0&&<div style={{maxWidth:440,margin:'0 auto 12px',fontSize:12,color:C.soonText,background:C.soonBg,border:`1px solid #F0D88A`,borderRadius:10,padding:'8px 11px',lineHeight:1.5}}>Las <b>{resultado.pendientes} sin cliente</b> quedaron guardadas como <b>pendientes por identificar</b> (no se cargan a nadie). Aparecen en Notaría · «Sin cliente» y te avisaré si pasan 3 días sin resolver.</div>}
      {notaria&&resultado.errores>0&&<details style={{maxWidth:440,margin:'0 auto 12px',textAlign:'left'}}>
        <summary style={{fontSize:12,color:C.overdueText,fontWeight:700,cursor:'pointer',listStyle:'none',textAlign:'center'}}>Ver las {resultado.errores} con error <Gl n='chevron'/></summary>
        <div style={{marginTop:6,maxHeight:180,overflowY:'auto',border:`1px solid ${C.border}`,borderRadius:8}}>
          {(resultado.erroresDet||[]).map((e,i)=><div key={i} style={{display:'flex',justifyContent:'space-between',gap:8,padding:'6px 9px',fontSize:11,borderTop:i?`1px solid ${C.bgSoft}`:'none'}}><span style={{minWidth:0,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',color:C.text}}>{e.ot?`OT ${e.ot} · `:''}{e.nombre}</span><span style={{color:C.overdueText,flexShrink:0,fontWeight:600}}>{e.motivo}</span></div>)}
        </div>
      </details>}
      {resultado.omitidos>0&&<div style={{fontSize:12,color:C.soonText,marginBottom:12,lineHeight:1.4}}><b>{resultado.omitidos} omitido(s)</b> porque ya existían idénticos (mismo cliente, monto, fecha y glosa) — duplicados evitados.</div>}
      <div style={{display:'flex',flexWrap:'wrap',gap:7,justifyContent:'center',marginBottom:18}}>
        {resultado.sinCliente>0&&<span style={{fontSize:11,color:C.muted,background:C.bgSoft,borderRadius:20,padding:'4px 11px'}}><b style={{color:C.text}}>{resultado.sinCliente}</b> sin cliente</span>}
        {resultado.sinFecha>0&&<span style={{fontSize:11,color:C.muted,background:C.bgSoft,borderRadius:20,padding:'4px 11px'}}><b style={{color:C.text}}>{resultado.sinFecha}</b> sin fecha</span>}
        {resultado.dupOmit>0&&<span style={{fontSize:11,color:'#8A5A12',background:C.soonBg,borderRadius:20,padding:'4px 11px'}}><b>{resultado.dupOmit}</b> duplicados omitidos</span>}
        {resultado.otDupOmit>0&&<span style={{fontSize:11,color:'#8A5A12',background:C.soonBg,borderRadius:20,padding:'4px 11px'}}><b>{resultado.otDupOmit}</b> con OT ya cargada</span>}
      </div>
      {notaria&&resultado.nota&&<div style={{display:'flex',gap:8,marginBottom:14}}>
        <div style={{flex:1,background:C.ambarBg,borderRadius:10,padding:'9px 10px',textAlign:'left'}}><div style={{fontSize:9,color:C.soonText,textTransform:'uppercase',letterSpacing:.3,fontWeight:600}}>Por pagar a notaría</div><div style={{fontSize:15,fontWeight:800,color:C.soonText,fontVariantNumeric:'tabular-nums'}}>{fmt(resultado.nota.porPagar)}</div></div>
        <div style={{flex:1,background:C.azulBg,borderRadius:10,padding:'9px 10px',textAlign:'left'}}><div style={{fontSize:9,color:C.azulInfo,textTransform:'uppercase',letterSpacing:.3,fontWeight:600}}>Por rendir</div><div style={{fontSize:15,fontWeight:800,color:C.azulInfo}}>{resultado.nota.clientes} cliente{resultado.nota.clientes!==1?'s':''}</div></div>
      </div>}
      {resultado.sinCliente>0&&<div style={{fontSize:12,color:C.muted,marginBottom:14,lineHeight:1.45}}>{notaria?<>Las <strong style={{color:C.text}}>{resultado.sinCliente} sin cliente</strong> quedaron en <strong style={{color:C.text}}>Gastos → "Sin cliente · por asignar"</strong>. Resuélvelas ahí con el Asistente IA — la app aprende y no te las vuelve a preguntar.</>:<>Los gastos sin cliente quedaron en <strong style={{color:C.text}}>Gastos → "Sin cliente · por asignar"</strong> para que les asignes cliente cuando puedas.</>}</div>}
      {notaria&&resultado.imported>0&&onNavigate&&<div style={{textAlign:'left',border:`1px solid ${C.border}`,borderRadius:10,overflow:'hidden',marginBottom:14}}>
        <div style={{fontSize:10,fontWeight:700,textTransform:'uppercase',letterSpacing:.4,color:C.muted,padding:'8px 12px',background:C.bgPanel,borderBottom:`.5px solid ${C.border}`}}>Próximos pasos</div>
        {resultado.sinCliente>0&&<div onClick={()=>onNavigate('orphans')} style={{display:'flex',alignItems:'center',gap:9,padding:'10px 12px',cursor:'pointer',borderBottom:`.5px solid ${C.track}`}}><span style={{width:26,height:26,borderRadius:8,background:C.overdueBg,display:'inline-flex',alignItems:'center',justifyContent:'center',flexShrink:0}}><svg width='15' height='15' viewBox='0 0 24 24' fill='none' stroke={C.overdueText} strokeWidth='2'><circle cx='9' cy='8' r='3'/><path d='M4 19c0-3 2-5 5-5'/><path d='M17 12v4M17 19v.01'/></svg></span><span style={{flex:1,fontSize:13,fontWeight:600,color:C.text}}>Resolver las {resultado.sinCliente} sin cliente</span><span style={{color:C.textSoft}}><Gl n='chevron'/></span></div>}
        <div onClick={()=>onNavigate('deuda')} style={{display:'flex',alignItems:'center',gap:9,padding:'10px 12px',cursor:'pointer',borderBottom:`.5px solid ${C.track}`}}><span style={{width:26,height:26,borderRadius:8,background:C.ambarBg,display:'inline-flex',alignItems:'center',justifyContent:'center',flexShrink:0}}><svg width='15' height='15' viewBox='0 0 24 24' fill='none' stroke={C.soonText} strokeWidth='2'><circle cx='12' cy='12' r='9'/><path d='M12 7v5l3 2'/></svg></span><span style={{flex:1,fontSize:13,fontWeight:600,color:C.text}}>Pagar a la notaría</span><span style={{color:C.textSoft}}><Gl n='chevron'/></span></div>
        <div onClick={()=>onNavigate('rendir')} style={{display:'flex',alignItems:'center',gap:9,padding:'10px 12px',cursor:'pointer'}}><span style={{width:26,height:26,borderRadius:8,background:C.azulBg,display:'inline-flex',alignItems:'center',justifyContent:'center',flexShrink:0}}><svg width='15' height='15' viewBox='0 0 24 24' fill='none' stroke={C.accent} strokeWidth='2'><path d='M4 4h16v14H4z'/><path d='M8 8h8M8 12h5'/></svg></span><span style={{flex:1,fontSize:13,fontWeight:600,color:C.text}}>Rendir a los clientes</span><span style={{color:C.textSoft}}><Gl n='chevron'/></span></div>
      </div>}
      {/* Parte por parte: tras Corregir queda el paso de Importar (y viceversa), sin perder el otro */}
      {resultado.corregirDone&&!resultado.importarDone&&resultado.nuevosPend>0&&<button disabled={guardando} onClick={aplicarImportar} style={{width:'100%',padding:12,borderRadius:10,border:'none',background:C.greenText,color:'#fff',fontSize:13,fontWeight:700,cursor:'pointer',marginBottom:9,opacity:guardando?.6:1}}>{guardando?'…':`Ahora importa las ${resultado.nuevosPend} nuevas →`}</button>}
      {resultado.importarDone&&!resultado.corregirDone&&resultado.actualizarPend>0&&<button disabled={guardando} onClick={aplicarCorregir} style={{width:'100%',padding:12,borderRadius:10,border:'none',background:C.azulInfo,color:'#fff',fontSize:13,fontWeight:700,cursor:'pointer',marginBottom:9,opacity:guardando?.6:1}}>{guardando?'…':`Ahora corrige las ${resultado.actualizarPend} →`}</button>}
      {notaria&&<div style={{display:'flex',gap:8,marginBottom:9}}>
        <button onClick={avisarSocios} disabled={avisadoSocios} style={{flex:1,padding:12,borderRadius:10,border:'none',background:avisadoSocios?C.done:C.normal,color:'#fff',fontSize:13,fontWeight:700,cursor:avisadoSocios?'default':'pointer'}}>{avisadoSocios?'Socios avisados':'Avisar a los socios'}</button>
        <button onClick={exportarCargaCSV} title='Exporta la carga a CSV' style={{flexShrink:0,padding:'12px 16px',borderRadius:10,border:`1px solid ${C.azulInfo}`,background:'#fff',color:C.azulInfo,fontSize:13,fontWeight:700,cursor:'pointer',display:'inline-flex',alignItems:'center',gap:6}}><svg width='14' height='14' viewBox='0 0 24 24' fill='none' stroke={C.azulInfo} strokeWidth='2' strokeLinecap='round' strokeLinejoin='round'><path d='M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4'/><polyline points='7 10 12 15 17 10'/><line x1='12' y1='15' x2='12' y2='3'/></svg>CSV</button>
      </div>}
      <button onClick={onClose} style={{width:'100%',padding:12,borderRadius:10,border:'none',background:C.accent,color:'#fff',fontSize:13,fontWeight:600,cursor:'pointer',marginBottom:9}}>Listo</button>
      {resultado.concil&&concilBefore&&concilBefore.length>0&&<button onClick={async()=>{ if(await appConfirm('¿Revertir las correcciones de cliente/categoría a como estaban antes?')){ const ok=await onUndoConciliar(concilBefore); if(ok){ setConcilBefore(null); onClose() } } }} style={{width:'100%',padding:12,borderRadius:10,border:`0.5px solid ${C.overdue}`,background:'#fff',color:C.overdue,fontSize:13,fontWeight:600,cursor:'pointer',marginBottom:9}}>Revertir correcciones ({concilBefore.length})</button>}
      {resultado.batchId&&resultado.imported>0&&<button onClick={()=>setUndoTarget({batchId:resultado.batchId,count:resultado.imported})} style={{width:'100%',padding:12,borderRadius:10,border:`0.5px solid ${C.overdue}`,background:'#fff',color:C.overdue,fontSize:13,fontWeight:600,cursor:'pointer'}}>Deshacer importación</button>}
      {undoTarget&&<UndoConfirm target={undoTarget} undoing={undoing} onCancel={()=>setUndoTarget(null)} onConfirm={async()=>{ setUndoing(true); const ok=await onUndoImport(undoTarget.batchId); setUndoing(false); if(ok){ setUndoTarget(null); onClose() } }}/>}
    </div>
  )

  // Bloques del paso de revisión (mismo contenido; en escritorio se reparten en 2 columnas, en móvil van en su orden de siempre).
  const cmAlarm = rows ? <>{(()=>{ const al=(rows||[]).filter(r=>['pagada','rendida'].includes(dupInfo[r.id]?.otState)); if(!al.length) return null; const nP=al.filter(r=>dupInfo[r.id].otState==='pagada').length, nR=al.length-nP; return (
            <div style={{background:C.overdueBg,border:`1px solid ${C.overdue}`,borderRadius:10,padding:'9px 11px',marginBottom:10}}>
              <div style={{fontSize:12,fontWeight:800,color:C.overdueText}}>{al.length} alarma{al.length!==1?'s':''} de OT — revísalas antes de importar</div>
              <div style={{fontSize:11,color:C.overdueText,marginTop:2}}>{nP>0?`${nP} ya pagada${nP!==1?'s':''} a la notaría`:''}{nP>0&&nR>0?' · ':''}{nR>0?`${nR} ya rendida${nR!==1?'s':''} al cliente`:''}. Aparecen marcadas abajo; no las cargues sin verlas.</div>
            </div>
          )})()}</> : null
  const cmHero = rows ? <>{notaria&&(()=>{ const val=(rows||[]).filter(r=>!r.error&&!r.noNuestra); const tot=val.reduce((a,r)=>a+(r.monto||0),0); const rend=val.filter(r=>r.client_id&&!r.personal_de&&!esOficinaCli(r.client_id)).reduce((a,r)=>a+(r.monto||0),0); const interno=val.filter(r=>r.personal_de||(r.client_id&&esOficinaCli(r.client_id))).reduce((a,r)=>a+(r.monto||0),0); const sinAsig=tot-rend-interno; const anul=notaCats(rows||[]).sinefecto.length
            const reconSolas=val.filter(r=>(r.client_id&&r.matchMethod!=='manual')||dupInfo[r.id]?.otState).length; const aprHoy=aprendidasSet.size; return (
            // Hero blanco (canon de la foto): protagonista = Total, con sus partes anidadas (a clientes / sin asignar / interno). Sin azul pleno.
            <div style={{background:'#fff',border:`1px solid ${C.border}`,borderRadius:14,padding:'13px 15px',marginBottom:12}}>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'baseline'}}><span style={{fontSize:11,fontWeight:700,textTransform:'uppercase',letterSpacing:.4,color:C.muted}}>Carga de notaría</span><span style={{fontSize:11,color:C.textSoft}}>{val.length} OT{anul?` · ${anul} anulada${anul!==1?'s':''}`:''}</span></div>
              <div style={{fontSize:27,fontWeight:800,color:C.accent,letterSpacing:-.6,margin:'3px 0 8px',fontVariantNumeric:'tabular-nums'}}>{fmt(tot)}</div>
              {reconSolas>0&&<div style={{display:'inline-flex',alignItems:'center',gap:6,background:C.greenBg,borderRadius:20,padding:'4px 11px',marginBottom:9}}><svg width='13' height='13' viewBox='0 0 24 24' fill='none' stroke={C.greenText} strokeWidth='2.4'><path d='M5 13l4 4L19 7'/></svg><span style={{fontSize:11,fontWeight:700,color:C.greenText}}>{reconSolas} de {val.length} reconocidas solas</span>{aprHoy>0&&<span style={{fontSize:11,color:C.greenText}}>· {aprHoy} aprendida{aprHoy!==1?'s':''} hoy</span>}</div>}
              <div style={{display:'flex',gap:10,borderTop:`1px solid ${C.track}`,paddingTop:9}}>
                <div style={{flex:1}}><div style={{...SEC_LBL}}>A clientes</div><div style={{fontSize:15,fontWeight:800,color:C.greenText,fontVariantNumeric:'tabular-nums'}}>{fmt(rend)}</div></div>
                <div style={{flex:1,borderLeft:`1px solid ${C.track}`,paddingLeft:10}}><div style={{...SEC_LBL}}>Sin asignar aún</div><div style={{fontSize:15,fontWeight:800,color:C.overdueText,fontVariantNumeric:'tabular-nums'}}>{fmt(sinAsig)}</div></div>
                {interno>0&&<div style={{flex:1,borderLeft:`1px solid ${C.track}`,paddingLeft:10}}><div style={{...SEC_LBL}}>Interno</div><div style={{fontSize:15,fontWeight:800,color:C.tealText,fontVariantNumeric:'tabular-nums'}}>{fmt(interno)}</div></div>}
              </div>
            </div>
          )})()}</> : null
  const cmBuckets = rows ? <>{modo!=='conciliar'&&!notaria&&<div style={{display:'flex',gap:6,marginBottom:10}}>
            {[['Auto','auto',nAuto,C.normal,'#BFE6D7'],['Sugeridos','sug',sugeridos.length,'#C77F18','#F0D88A'],['Revisar','rev',nRev,C.overdue,'#F3C0C0'],['Manual','man',nMan,C.muted,C.border]].map(([l,k,n,col,bd])=>{ const on=bucketFilter===k; return (
              // Bucket = filtro clickeable (no KPI de plata): toca para ver solo ese grupo, toca de nuevo para todo.
              <div key={l} onClick={()=>setBucketFilter(f=>f===k?null:k)} style={{flex:1,border:`1px solid ${on?col:bd}`,background:on?col:'transparent',borderRadius:10,padding:'8px 4px',textAlign:'center',cursor:'pointer'}}>
                <div style={{fontSize:18,fontWeight:700,letterSpacing:-.4,color:on?'#fff':col}}>{n}</div>
                <div style={{fontSize:10,fontWeight:600,textTransform:'uppercase',letterSpacing:.4,color:on?'#fff':col,marginTop:1}}>{l}</div>
              </div>
            )})}
          </div>}</> : null
  const cmMatching = rows ? <>{matching&&<div style={{display:'flex',alignItems:'center',gap:8,fontSize:12,color:C.accent,background:C.azulBg,borderRadius:8,padding:'8px 10px',marginBottom:8}}><Spin/>Analizando {rows.length} filas con IA{matchProg?` · lote ${matchProg.done}/${matchProg.total}`:''}…</div>}</> : null
  const cmActs = rows ? <>{modo!=='conciliar'&&<div style={isDeskCM?{display:'flex',flexDirection:'column',gap:7}:{display:'flex',gap:7,marginBottom:10,flexWrap:'wrap'}}>
            {notaria&&(()=>{ const nSin=(rows||[]).filter(r=>!r.client_id&&!r.personal_de&&!r.isInternal&&!r.error&&!r.suggestion).length; return (
              <button disabled={!!driveAll||(!nSin&&!driveAll)} onClick={buscarTodasDrive} title='Busca en tus carpetas de Drive el cliente de cada OT sin cliente' style={{flex:isDeskCM?'none':'1 1 120px',padding:'9px 8px',borderRadius:8,fontSize:12,fontWeight:600,cursor:driveAll||!nSin?'default':'pointer',border:`1px solid ${C.accent}`,background:driveAll?C.azulBg:'#fff',color:C.accent,opacity:driveAll||!nSin?.6:1,display:'inline-flex',alignItems:'center',justifyContent:'center',gap:6}}>
                <svg width='13' height='13' viewBox='0 0 24 24' fill='none' stroke={C.accent} strokeWidth='2' strokeLinecap='round' strokeLinejoin='round'><path d='M22 12l-4-4v3h-8v2h8v3z'/><path d='M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h8'/></svg>
                {driveAll?`Buscando en Drive ${driveAll.done}/${driveAll.total}…`:`Buscar todas en Drive${nSin?` (${nSin})`:''}`}
              </button>
            )})()}
            {!notaria&&<button disabled={sugeridos.length===0} onClick={confirmarSugeridos} style={{flex:isDeskCM?'none':'1 1 120px',padding:'9px 8px',borderRadius:8,fontSize:12,fontWeight:600,cursor:sugeridos.length?'pointer':'default',border:'1px solid #F0D88A',background:sugeridos.length?C.soonBg:C.bgSoft,color:C.soon,opacity:sugeridos.length?1:.5}}>Confirmar sugeridos ({sugeridos.length})</button>}
            {notaria
              ? (()=>{ const nSel=(rows||[]).filter(notaSelOn).length; return <button disabled={guardando||!nSel} onClick={async()=>{ const sel=(rows||[]).filter(notaSelOn); if(!sel.length){appAlert('Marca al menos una OT para importar.');return} if(await appConfirm(msgCargaNota(sel))) guardar(false, sel) }} style={{flex:isDeskCM?'none':'1 1 200px',order:isDeskCM?-1:0,padding:'10px 8px',borderRadius:8,fontSize:13,fontWeight:700,cursor:nSel?'pointer':'default',border:'none',background:C.accent,color:'#fff',opacity:nSel?1:.5}}>Importar seleccionadas ({nSel})</button> })()
              : <button disabled={guardando||listas.length===0} onClick={()=>guardar(false)} style={{flex:isDeskCM?'none':'1 1 120px',order:isDeskCM?-1:0,padding:'9px 8px',borderRadius:8,fontSize:12,fontWeight:600,cursor:listas.length?'pointer':'default',border:'none',background:C.accent,color:'#fff',opacity:listas.length?1:.5}}>Importar listos ({listas.length})</button>}
            {!notaria&&<button disabled={guardando||rows.length===0} onClick={async()=>{ if(await appConfirm(`Importar las ${rows.length} filas, incluso las sin cliente (quedan sin asignar) y sin monto (como $0)?`)) guardar(true) }} style={{flex:isDeskCM?'none':'1 1 110px',padding:'9px 8px',borderRadius:8,fontSize:12,fontWeight:600,cursor:'pointer',border:`1px solid ${C.border}`,background:'#fff',color:C.accent}}>Importar todo ({rows.length})</button>}
          </div>}</> : null
  const cmDups = rows ? <>{dups.length>0&&modo!=='conciliar'&&<div style={{fontSize:11,color:C.soon,background:'#FEF6EE',border:'1px solid #F5E2CC',borderRadius:8,padding:'8px 10px',marginBottom:8}}>
            <div onClick={()=>setShowDup(s=>!s)} style={{cursor:'pointer'}}>Se detectaron {dups.length} fila(s) duplicada(s) (mismo cliente, fecha, monto y concepto) dentro del archivo. <b style={{textDecoration:'underline'}}>{showDup?'ocultar':'ver cuáles'}</b></div>
            {showDup&&<div style={{marginTop:6,maxHeight:170,overflowY:'auto',background:'#fff',borderRadius:8}}>
              {dups.map(r=>{ const c=clients.find(x=>String(x.id)===String(r.client_id)); return (
                <div key={r.id} style={{padding:'6px 9px',borderTop:`0.5px solid ${C.border}`,fontSize:11}}>
                  <div style={{display:'flex',justifyContent:'space-between',gap:8}}><span style={{fontWeight:600,color:C.text,minWidth:0,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{c?.name||r.clientName||r.nombre||'—'}</span><span style={{color:C.muted,flexShrink:0}}>${(r.monto||0).toLocaleString('es-CL')}</span></div>
                  <div style={{color:C.muted,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{r.concepto||'—'} · {r.fecha?String(r.fecha).slice(0,10):'sin fecha'}</div>
                </div>
              )})}
            </div>}
          </div>}</> : null
  const cmList = rows ? <>{modo!=='conciliar'&&(<>
          {/* Resumen de abogados involucrados: tocar un nombre filtra las filas de ese responsable */}
          {!notaria&&(()=>{ const m={}; rows.forEach(r=>{ const k=respDeRow(r)||'__sin__'; m[k]=(m[k]||0)+1 }); const ents=Object.entries(m).sort((a,b)=>b[1]-a[1]); if(!ents.length) return null; return (
            <div style={{display:'flex',gap:6,flexWrap:'wrap',alignItems:'center',marginBottom:10}}>
              <span style={{fontSize:10,color:C.textSoft,fontWeight:600,textTransform:'uppercase',letterSpacing:.4}}>Abogados</span>
              {ents.map(([k,n])=>{ const sin=k==='__sin__'; const pc=sin?{bg:C.bgWarm,color:C.grisText}:personChip(k); const on=respFilter===k; return (
                <button key={k} onClick={()=>setRespFilter(on?null:k)} style={pillPersonaSty(pc,on)}>{sin?'Oficina':k} · {n}</button>
              )})}
              {respFilter&&<button onClick={()=>setRespFilter(null)} style={{fontSize:11,background:'none',border:'none',color:C.muted,cursor:'pointer'}}>Ver todos</button>}
            </div>
          )})()}
          {notaria&&similarPrompt&&(
            <div style={{border:`1px solid ${C.accent}`,background:C.azulBg,borderRadius:10,padding:'10px 12px',marginBottom:10,display:'flex',alignItems:'center',gap:10,flexWrap:'wrap'}}>
              <svg width='18' height='18' viewBox='0 0 24 24' fill='none' stroke={C.accent} strokeWidth='2' strokeLinecap='round' strokeLinejoin='round'><path d='M9 18h6M10 22h4M12 2a7 7 0 0 0-4 12.7c.6.5 1 1.3 1 2.3h6c0-1 .4-1.8 1-2.3A7 7 0 0 0 12 2z'/></svg>
              <div style={{flex:1,minWidth:120}}><div style={{fontSize:13,fontWeight:700,color:C.accent}}>Asignaste a {similarPrompt.clientName}</div><div style={{fontSize:11,color:C.accent}}>Hay {similarPrompt.ids.length} OT más de compareciente parecido a «{similarPrompt.srcName}»</div></div>
              <button onClick={()=>{ const {clientId,ids}=similarPrompt; setSimilarPrompt(null); ids.forEach(id=>asignar(id,clientId)) }} style={{fontSize:12,fontWeight:700,color:'#fff',background:C.accent,border:'none',borderRadius:8,padding:'7px 13px',cursor:'pointer'}}>Asignar las {similarPrompt.ids.length} a {similarPrompt.clientName}</button>
              <button onClick={()=>setSimilarPrompt(null)} style={{fontSize:12,fontWeight:600,color:C.muted,background:'none',border:'none',cursor:'pointer'}}>No</button>
            </div>
          )}
          <div style={{maxHeight:notaria?'none':360,overflowY:notaria?'visible':'auto',border:(notaria&&modo!=='conciliar')?'none':`1px solid ${C.border}`,borderRadius:8,marginBottom:12}}>
            {notaria && modo!=='conciliar' ? notaCatsUI(rows) : (()=>{ const flt=rows.filter(r=>(!respFilter||(respDeRow(r)||'__sin__')===respFilter)&&(!bucketFilter||bucketOf(r)===bucketFilter)); const items = notaria ? notaItems(flt) : flt.map(r=>({type:'row',r})); return items.map((item,ii)=>{
              if(item.type==='header'){
                if(item.kind==='sin') return (<div key={'hs'+ii} style={{display:'flex',alignItems:'center',gap:8,padding:'10px 12px',background:C.overdueBg,borderBottom:`1px solid ${C.overdue}`}}><svg width='14' height='14' viewBox='0 0 24 24' fill='none' stroke={C.overdueText} strokeWidth='2'><circle cx='12' cy='12' r='10'/><path d='M12 16v-4M12 8h.01'/></svg><span style={{flex:1,fontSize:13,fontWeight:700,color:C.overdueText}}>Sin cliente · por revisar</span><span style={{fontSize:11,fontWeight:600,color:C.overdueText}}>{item.n} OT · {fmt(item.tot)}</span></div>)
                if(item.kind==='sub') return (<div key={'hsub'+ii} style={{display:'flex',alignItems:'center',gap:8,padding:'6px 12px 6px 24px',background:'#fff',borderTop:`0.5px solid ${C.border}`}}><span style={{fontSize:12,fontWeight:700,color:C.text,minWidth:0,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{item.name}</span><span style={{fontSize:10,fontWeight:600,color:C.muted,background:C.bgSoft,borderRadius:20,padding:'0 6px'}}>{item.n} OT</span><span style={{marginLeft:'auto',fontSize:11,color:C.muted}}>{fmt(item.tot)}</span></div>)
                if(item.kind==='app') return (<div key={'happ'+ii} onClick={()=>setEnAppOpen(o=>!o)} style={{display:'flex',alignItems:'center',gap:8,padding:'10px 12px',background:C.bgSoft,borderBottom:enAppOpen?`1px solid ${C.border}`:'none',cursor:'pointer'}}><span style={{fontSize:13,color:C.textSoft,transform:enAppOpen?'rotate(90deg)':'none',transition:'transform .15s'}}><Gl n='chevron'/></span><span style={{flex:1,fontSize:12,fontWeight:600,color:C.muted}}>Ya en la app · se omiten al importar</span><span style={{fontSize:11,color:C.muted}}>{item.n} OT</span></div>)
                const g=item.g; const cubre=g.saldo!=null&&g.saldo>=g.tot; const adel=g.saldo!=null?Math.max(0,g.tot-g.saldo):0
                const selG=g.rs.filter(notaSelOn).length, allG=g.rs.filter(r=>r.client_id&&!r.error).length, gOpen=grpOpen.has(g.cid)
                return (<div key={'hc'+g.cid} style={{display:'flex',alignItems:'center',gap:8,padding:'10px 12px',background:C.bgSoft,borderBottom:`1px solid ${C.border}`}}>
                  <span onClick={()=>setDeselNota(p=>{ const n=new Set(p); const marcarTodo=selG<allG; g.rs.forEach(r=>{ if(r.client_id&&!r.error){ marcarTodo?n.delete(r.id):n.add(r.id) } }); return n })} title={selG<allG?'Marcar todo el grupo':'Desmarcar el grupo'} style={{cursor:'pointer',flexShrink:0,display:'inline-flex'}}>{selG===allG&&allG>0?<svg width='16' height='16' viewBox='0 0 24 24' fill={C.accent} stroke={C.accent}><rect x='3' y='3' width='18' height='18' rx='4'/><path d='M8 12l3 3 5-6' stroke='#fff' strokeWidth='2.4' fill='none' strokeLinecap='round' strokeLinejoin='round'/></svg>:<svg width='16' height='16' viewBox='0 0 24 24' fill='none' stroke={C.done} strokeWidth='1.6'><rect x='3' y='3' width='18' height='18' rx='4'/>{selG>0&&<line x1='7' y1='12' x2='17' y2='12' stroke={C.accent} strokeWidth='2.4'/>}</svg>}</span>
                  <span onClick={()=>toggleGrpNota(g.cid)} style={{flex:1,minWidth:0,display:'flex',alignItems:'center',gap:8,cursor:'pointer'}}>
                    <span style={{fontSize:13,color:C.textSoft,transform:gOpen?'rotate(90deg)':'none',transition:'transform .15s',flexShrink:0}}><Gl n='chevron'/></span>
                    <span style={{flex:1,minWidth:0}}><span style={{fontSize:13,fontWeight:700,color:C.accent}}>{g.name}{g.nEnt>1&&<span style={{fontSize:10,fontWeight:600,color:C.muted,border:`1px solid ${C.border}`,borderRadius:20,padding:'0 6px',marginLeft:6}}>{g.nEnt} RS</span>}</span>{g.saldo!=null&&<span style={{fontSize:10,fontWeight:600,color:cubre?C.greenText:C.overdueText,marginLeft:6}}>· {cubre?'cubre':`adelanto ${fmt(adel)}`}</span>}</span>
                    <span style={{fontSize:11,color:C.muted,flexShrink:0}}>{selG} de {g.rs.length} · {fmt(g.tot)}</span>
                  </span>
                </div>)
              }
              const r=item.r
              if(notaria) return notaRowCard(r)
              const bucket = bucketOf(r)
              const bad = montoBad(r)
              const ents = r.client_id ? entsOf(r.client_id) : []
              const bg = bad?C.overdueBg:(bucket==='auto'?C.greenBg:bucket==='sug'?C.soonBg:bucket==='rev'?C.overdueBg:C.bgSoft)
              const badge = bad?['Error',C.overdue,'#fff']:(bucket==='auto'?[r.personal_de?'Personal':r.isInternal?'Interno':r.matchMethod==='aprendido'?'Aprendido':'Auto',C.normal,'#fff']:bucket==='sug'?[`Sugerido ${r.confidence||''}%`,'#C77F18','#fff']:bucket==='rev'?[`Revisar ${r.confidence||''}%`,C.overdue,'#fff']:['Sin cliente',C.muted,'#fff'])
              if((r.isInternal||r.personal_de)&&!bad) badge[1]=C.muted
              return (
                <div key={r.id} style={{padding:'10px 12px',borderBottom:`1px solid ${C.border}`,background:bg}}>
                  <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:6}}>
                    <span style={{fontSize:9,fontWeight:700,textTransform:'uppercase',letterSpacing:.4,color:badge[2],background:badge[1],borderRadius:4,padding:'2px 7px',flexShrink:0,whiteSpace:'nowrap'}}>{badge[0]}</span>
                    <span style={{fontSize:11,color:C.muted,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{r.fecha||'sin fecha'} · {r.rut||r.nombre||'sin RUT'}</span>
                    {r.ot&&<span style={{fontSize:9.5,fontWeight:700,color:C.azulInfo,background:C.azulBg,borderRadius:20,padding:'2px 8px',flexShrink:0,whiteSpace:'nowrap'}}>{String(r.ot).toUpperCase().startsWith('OT')?r.ot:'OT-'+r.ot}</span>}
                    {r.dup&&<span style={{fontSize:9.5,fontWeight:700,color:C.soon,background:'#FEF6EE',border:'1px solid #F5E2CC',borderRadius:20,padding:'2px 8px',flexShrink:0,whiteSpace:'nowrap'}}>Duplicada</span>}
                    <span style={{marginLeft:'auto',fontSize:13,fontWeight:700,color:bad?C.overdue:C.text,flexShrink:0}}>{bad?'$0':fmt(r.monto)}</span>
                  </div>
                  {bad&&<div style={{fontSize:11,color:C.overdue,fontWeight:600,marginBottom:6}}>Sin monto válido — se importa como $0 solo con "Importar todo".</div>}
                  {/* concepto (con corrección de IA si aplica) */}
                  {/* Glosa final combinada (lo que se guarda), en una línea. Concepto + Subconcepto quedan editables debajo. */}
                  <div style={{display:'flex',alignItems:'baseline',gap:6,marginBottom:6,flexWrap:'wrap'}}>
                    <span style={{fontSize:9,fontWeight:700,color:C.muted,textTransform:'uppercase',letterSpacing:.4,flexShrink:0}}>Glosa</span>
                    <span style={{fontSize:13,fontWeight:600,color:C.text}}>{glosaFinal(r)||'—'}</span>
                    {r.conceptoFix&&<span style={{fontSize:9.5,fontWeight:700,color:C.greenText,background:C.greenBg,borderRadius:20,padding:'2px 8px',flexShrink:0,whiteSpace:'nowrap'}}>IA</span>}
                  </div>
                  {(r.requirente||r.materia)&&<div style={{fontSize:10,color:C.muted,marginBottom:6,lineHeight:1.4}}>{r.materia?<>Materia: <b style={{color:C.text}}>{r.materia}</b></>:''}{r.materia&&r.requirente?' · ':''}{r.requirente?<>Requirente: <b style={{color:C.text}}>{r.requirente}</b></>:''}</div>}
                  {dupInfo[r.id]?.otDup&&(()=>{ const e=dupInfo[r.id].otDup, st=dupInfo[r.id].otState; const otL=String(r.ot).toUpperCase().startsWith('OT')?String(r.ot).toUpperCase():'OT-'+r.ot; const cn=e.client_id?(clients.find(c=>String(c.id)===String(e.client_id))?.name||'el cliente'):'el cliente'
                    if(st==='pagada') return <div style={{fontSize:11,fontWeight:700,color:C.overdueText,background:C.overdueBg,border:`1px solid ${C.overdue}`,borderRadius:6,padding:'6px 9px',marginBottom:6}}>Alarma · {otL} ya la pagaste a la notaría{e.notaria_liquidado_at?` (liquidación del ${fmtFDMY(e.notaria_liquidado_at)})`:''}. Si te la re-cobran, no la pagues de nuevo.</div>
                    if(st==='rendida') return <div style={{fontSize:11,fontWeight:700,color:C.coralText,background:'#FAECE7',border:'1px solid #E3C4B8',borderRadius:6,padding:'6px 9px',marginBottom:6}}>Alarma · {otL} ya la rendiste a {cn}{(e.client_rendered_at||e.rendered_at)?` (${fmtFDMY(e.client_rendered_at||e.rendered_at)})`:''}. Ya se cobró — revísala antes de cargar.</div>
                    return <div style={{fontSize:11,fontWeight:600,color:C.muted,background:C.bgSoft,border:`1px solid ${C.border}`,borderRadius:6,padding:'5px 8px',marginBottom:6}}>{otL} ya cargada — se omite al importar (no se duplica).</div>
                  })()}
                  {dupInfo[r.id]?.manualDup&&!dupInfo[r.id]?.otDup&&<div style={{fontSize:11,fontWeight:600,color:C.soonText,background:'#FEF6EE',border:'1px solid #F5E2CC',borderRadius:6,padding:'5px 8px',marginBottom:6}}>¿Duplica un gasto cargado a mano? «{(dupInfo[r.id].manualDup.concept||'').slice(0,40)}» · {fmt(dupInfo[r.id].manualDup.amount)}. Revísalo antes de importar.</div>}
                  <div style={{display:'flex',gap:6,alignItems:'center',flexWrap:'wrap'}}>
                    <input value={r.concepto} onChange={e=>editarCampo(r.id,'concepto',e.target.value)} placeholder='Concepto'
                      style={{flex:'1 1 140px',minWidth:120,padding:'6px 8px',borderRadius:6,border:`1px solid ${C.border}`,fontSize:12,background:'#fff',color:C.text,outline:'none'}}/>
                    {tipo==='gasto'&&(
                      <select value={CAT_OPCIONES.includes(r.categoria)?r.categoria:'Otro'} onChange={e=>editarCampo(r.id,'categoria',e.target.value)}
                        style={{flex:'0 0 auto',padding:'6px 8px',borderRadius:6,border:`1px solid ${C.border}`,fontSize:12,background:'#fff',color:C.text,outline:'none'}}>
                        {CAT_OPCIONES.map(c=><option key={c} value={c}>{c}</option>)}
                      </select>
                    )}
                  </div>
                  {tipo==='gasto'&&proyCampo(r)&&<div style={{marginTop:6}}>{proyCampo(r)}</div>}
                  {r.subconcepto&&<input value={r.subconcepto} onChange={e=>editarCampo(r.id,'subconcepto',e.target.value)} placeholder='Subconcepto' style={{width:'100%',marginTop:6,padding:'6px 8px',borderRadius:6,border:`1px solid ${C.border}`,fontSize:12,background:'#fff',color:C.muted,outline:'none',boxSizing:'border-box'}}/>}
                  {/* ¿De quién es? — solo cuando no calzó un cliente externo (sin cliente u oficina): a un miembro (personal) o se deja para la oficina */}
                  {tipo==='gasto'&&!r.personal_de&&(!r.client_id||esOficinaCli(r.client_id))&&(
                    <div style={{marginTop:7}}>
                      <div style={{...SEC_LBL,marginBottom:5}}>¿De quién es? <span style={{textTransform:'none',letterSpacing:0,fontWeight:400}}>· o déjalo para la oficina</span></div>
                      <div style={{display:'flex',gap:6,flexWrap:'wrap'}}>
                        {['Cristóbal','Erasmo','Martín','Martina','Rodrigo'].map(m=>{const pc=personChip(m);return <button key={m} type='button' onClick={()=>asignarPersonal(r.id,m)} style={{fontSize:11,borderRadius:20,padding:'3px 11px',fontWeight:600,cursor:'pointer',background:pc.bg,color:pc.color,border:`0.5px solid ${pc.color}33`}}>{m}</button>})}
                      </div>
                    </div>
                  )}
                  {/* Buscar en Drive: para OT sin cliente, busca el compareciente en las carpetas y propone el cliente por la carpeta */}
                  {notaria&&!r.client_id&&!r.personal_de&&(bucket==='man'||bucket==='rev')&&(
                    <div style={{marginTop:6,display:'flex',alignItems:'center',gap:8,flexWrap:'wrap'}}>
                      <button disabled={driveBusy===r.id} onClick={async()=>{ setDriveBusy(r.id); setDriveMsg(m=>({...m,[r.id]:''})); const res=await driveFindClient(r.nombre||r.requirente); setDriveBusy(null); if(res?.client){ asignar(r.id,res.client.id); setDriveMsg(m=>({...m,[r.id]:`✓ ${res.client.name} · carpeta "${res.folder}"`})) } else setDriveMsg(m=>({...m,[r.id]: res?.error?('Error: '+res.error):'No lo encontré en Drive'})) }} style={{fontSize:11,fontWeight:600,color:C.accent,background:C.azulBg,border:'none',borderRadius:8,padding:'5px 11px',cursor:driveBusy===r.id?'default':'pointer',display:'inline-flex',alignItems:'center',gap:6,opacity:driveBusy===r.id?.6:1}}><svg width='12' height='12' viewBox='0 0 24 24' fill='none' stroke={C.accent} strokeWidth='2' strokeLinecap='round' strokeLinejoin='round'><path d='M22 12l-4-4v3h-8v2h8v3z'/><path d='M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h8'/></svg>{driveBusy===r.id?'Buscando en Drive…':'Buscar en Drive'}</button>
                      {driveMsg[r.id]&&<span style={{fontSize:11,fontWeight:600,color:driveMsg[r.id].startsWith('✓')?C.greenText:C.muted}}>{driveMsg[r.id]}</span>}
                    </div>
                  )}
                  {/* resolución de cliente según estado */}
                  <div style={{marginTop:7}}>
                    {bucket==='auto'&&r.personal_de&&(
                      <div style={{display:'flex',gap:6,alignItems:'center',justifyContent:'flex-end'}}>
                        <span style={{fontSize:12,color:C.accent,fontWeight:700,marginRight:'auto',display:'inline-flex',alignItems:'center',gap:5}}>Personal · {(()=>{ const pc=personChip(r.personal_de); return <span style={{fontSize:12,color:pc.color,fontWeight:700}}>{r.personal_de}</span> })()}</span>
                        <button type='button' onClick={()=>asignarPersonal(r.id,null)} style={{fontSize:11,background:'none',border:'none',color:C.muted,cursor:'pointer'}}>Quitar</button>
                        <AsignarClienteInline bill={{id:r.id}} clients={clients} onAssign={(_,cid)=>asignar(r.id,cid)} label='Asignar cliente'/>
                      </div>
                    )}
                    {bucket==='auto'&&!r.isInternal&&!r.personal_de&&(
                      <div style={{display:'flex',gap:6,alignItems:'center',justifyContent:'flex-end',flexWrap:'wrap'}}>
                        <span style={{fontSize:12,color:C.normal,fontWeight:600,marginRight:'auto',display:'inline-flex',alignItems:'center',gap:6}}>{r.clientName}{(()=>{ const resp=clients.find(c=>c.id===r.client_id)?.abogado_responsable; if(!resp) return null; const pc=personChip(resp); return <span style={{fontSize:11,color:pc.color,fontWeight:700}}>{resp}</span> })()}</span>
                        {ents.length>1&&(
                          <select value={r.entity_id||''} onChange={e=>editarCampo(r.id,'entity_id',e.target.value||null)} style={{padding:'5px 7px',borderRadius:6,border:`1px solid ${r.entity_id?C.border:C.soon}`,fontSize:11,background:'#fff',color:C.text,outline:'none',maxWidth:170}}>
                            <option value=''>Elegir razón social…</option>
                            {ents.map(en=><option key={en.id} value={en.id}>{en.name}</option>)}
                          </select>
                        )}
                        {ents.length===1&&<span style={{fontSize:10,color:C.muted}}>{ents[0].name}</span>}
                        <AsignarClienteInline bill={{id:r.id}} clients={clients} onAssign={(_,cid)=>asignar(r.id,cid)} label='Cambiar'/>
                      </div>
                    )}
                    {bucket==='auto'&&r.isInternal&&(
                      <div style={{display:'flex',gap:6,alignItems:'center',justifyContent:'flex-end'}}>
                        <span style={{fontSize:12,color:C.muted,fontWeight:600,marginRight:'auto'}}>Gasto interno de la firma</span>
                        <AsignarClienteInline bill={{id:r.id}} clients={clients} onAssign={(_,cid)=>asignar(r.id,cid)} label='Asignar cliente'/>
                      </div>
                    )}
                    {bucket==='sug'&&(
                      <div style={{display:'flex',gap:6,alignItems:'center',flexWrap:'wrap'}}>
                        <span style={{fontSize:12,color:C.text,fontWeight:600}}>{r.suggestion.name}</span>
                        {(r.notaWhy?.length||r.aiReason)&&<span style={{fontSize:10,color:C.muted,fontStyle:'italic',flex:1,minWidth:0,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{r.notaWhy?.length?`por ${r.notaWhy.join(', ')}`:r.aiReason}</span>}
                        <button onClick={()=>asignar(r.id,r.suggestion.id)} style={{marginLeft:'auto',fontSize:12,fontWeight:600,padding:'5px 11px',borderRadius:8,border:'none',background:C.greenText,color:'#fff',cursor:'pointer'}}>Confirmar</button>
                        <AsignarClienteInline bill={{id:r.id}} clients={clients} onAssign={(_,cid)=>asignar(r.id,cid)} label='Cambiar'/>
                      </div>
                    )}
                    {bucket==='rev'&&(
                      <select value='' onChange={e=>e.target.value&&asignar(r.id,e.target.value)} style={{width:'100%',padding:'7px 9px',borderRadius:8,border:`1px solid ${C.overdue}`,fontSize:12,background:'#fff',color:C.text,outline:'none'}}>
                        <option value=''>Elige el cliente… ({r.candidates.length} candidatos)</option>
                        {r.candidates.map(c=><option key={c.id} value={c.id}>{c.name} ({c.score}%)</option>)}
                      </select>
                    )}
                    {bucket==='man'&&(
                      <div>
                        <div style={{display:'flex',gap:6,alignItems:'center',flexWrap:'wrap'}}>
                          <div style={{flex:'1 1 160px',minWidth:0}}><AsignarClienteInline bill={{id:r.id}} clients={clients} onAssign={(_,cid)=>asignar(r.id,cid)} label='Buscar cliente por nombre o RUT…'/></div>
                          {r.nombre&&onCreateOccasional&&<button onClick={()=>setOcasPick(ocasPick===r.id?null:r.id)} title={`Crear cliente ocasional "${r.nombre}"`} style={{flexShrink:0,fontSize:11,fontWeight:600,padding:'5px 10px',borderRadius:8,border:`1px solid ${ocasPick===r.id?C.accent:C.border}`,background:'#fff',color:C.accent,cursor:'pointer'}}>+ Ocasional {ocasPick===r.id?<Gl n='chevU'/>:<Gl n='chevD'/>}</button>}
                        </div>
                        {ocasPick===r.id&&(
                          <div style={{display:'flex',gap:6,flexWrap:'wrap',alignItems:'center',marginTop:6}}>
                            <span style={{fontSize:10,color:C.muted,fontWeight:600}}>Ocasional «{r.nombre}» · responsable:</span>
                            {['Cristóbal','Erasmo','Martín','Martina','Rodrigo'].map(m=>{const p=personChip(m);return <button key={m} onClick={()=>crearOcasional(r,m)} style={{fontSize:11,borderRadius:20,padding:'3px 10px',fontWeight:600,cursor:'pointer',background:p.bg,color:p.color,border:'none'}}>{m}</button>})}
                            <button onClick={()=>crearOcasional(r,null)} style={{fontSize:11,borderRadius:20,padding:'3px 10px',fontWeight:600,cursor:'pointer',background:C.bgWarm,color:C.grisText,border:'none'}}>Sin responsable</button>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              )
            }) })()}
          </div>
          </>)}</> : null
  const cmSel = (rows&&notaria&&isDeskCM) ? (()=>{ const sel=(rows||[]).filter(notaSelOn); const t=sel.reduce((a,r)=>a+(r.monto||0),0); return <div style={{display:'flex',justifyContent:'space-between',alignItems:'baseline',gap:10,background:C.azulBg,borderRadius:10,padding:'9px 12px'}}><span style={{fontSize:11.5,fontWeight:600,color:C.azulInfo}}>Seleccionadas · {sel.length} OT</span><b style={{fontSize:15,color:C.accent,fontVariantNumeric:'tabular-nums'}}>{fmt(t)}</b></div> })() : null
  // Modo conciliar (volver a cargar): 'resto' = info + pestañas Corregir/Nuevos con su lista + posibles + avisos; 'acc' = resumen y botones. Escritorio: acc al lateral.
  const concilUI = (part) => { if(!(modo==='conciliar'&&concil)) return null

            const rend=concil.actualizar.filter(a=>a.rendido)
            const sinCli=concil.nuevos.filter(r=>!r.client_id&&!r.personal_de)
            const nCorr=corregirSel().length, nNuev=nuevosSel().length   // lo realmente tildado
            const cn=(r)=>{ const c=clients.find(x=>String(x.id)===String(r.client_id)); return c?.name||r?.clientName||r?.nombre||'sin cliente' }
            // Otros gastos del mismo cliente y monto (candidatos a re-calzar una fila mal emparejada).
            const candidatosDe=(r)=>(expenses||[]).filter(e=>!e.deleted_at && (tipo==='fondo'?e.type==='fondo':e.type!=='fondo') && String(e.client_id||'')===String(r.client_id||'') && (e.amount||0)===(r.monto||0))
            const chgCli=it=>{const r=it.r||it,e=it.e,rendido=it.rendido; return e&&!(rendido&&noTocarRendidos)&&String(e.client_id||'')!==String(r.client_id||e.client_id||'')}
            const chgCat=it=>{const r=it.r||it,e=it.e; return e&&String(e.category||'')!==String((tipo==='fondo'?'Fondo':(r.categoria||e.category))||'')}
            const lista=(items,kind)=>{
              const q=concilQ.trim().toLowerCase()
              let vis = q ? items.filter(it=>{const r=it.r||it; return (cn(r)+' '+(r.concepto||'')).toLowerCase().includes(q)}) : items
              if(kind==='act'&&chgFilter!=='all') vis = vis.filter(chgFilter==='cli'?chgCli:chgCat)
              const selectable=(kind==='act'||kind==='new')
              const exKeyOf=it=>{const r=it.r||it,e=it.e; return kind==='act'?('c_'+(e&&e.id)):('n_'+r.id)}
              const renderItem=(it,j)=>{ const r=it.r||it, e=it.e, rendido=it.rendido; const exKey=exKeyOf(it); const checked=!selectable||!concilExcl.has(exKey); return (
                <div key={(e&&e.id)||(r.id+'_'+j)} style={{padding:'7px 13px',borderTop:j?`0.5px solid ${C.border}`:'none',fontSize:11,display:'flex',gap:9,alignItems:'flex-start',opacity:selectable&&!checked?.45:1}}>
                  {selectable&&<input type='checkbox' checked={checked} onChange={()=>toggleExcl(exKey)} title={checked?'Incluida — destilda para omitir':'Omitida'} style={{marginTop:2,flexShrink:0,cursor:'pointer'}}/>}
                  <div style={{flex:1,minWidth:0}}>
                  <div style={{display:'flex',justifyContent:'space-between',gap:8}}><span style={{fontWeight:600,color:C.text,minWidth:0,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{cn(r)}</span><span style={{color:C.muted,flexShrink:0}}>${(r.monto||0).toLocaleString('es-CL')}</span></div>
                  <div style={{color:C.muted,marginTop:1,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{r.concepto||'—'}{kind==='dup'?<span style={{color:C.textSoft}}> · {r.fecha?String(r.fecha).slice(0,10):'sin fecha'}</span>:(kind!=='act'&&kind!=='new'&&e)?<span style={{color:C.textSoft}}> · → {r.categoria||e.category||'Otro'}</span>:''}</div>
                  {kind==='act'&&(()=>{ const newCat=tipo==='fondo'?'Fondo':(r.categoria||e.category); const catChg=String(e.category||'')!==String(newCat||''); const newCli=r.client_id||e.client_id; const cliChg=!(rendido&&noTocarRendidos)&&String(e.client_id||'')!==String(newCli||''); const nm=id=>{const c=clients.find(x=>String(x.id)===String(id));return c?.name||'Sin cliente'}; return (catChg||cliChg)?<div style={{display:'flex',gap:5,flexWrap:'wrap',marginTop:3}}>{cliChg&&<span style={{fontSize:9.5,fontWeight:700,padding:'2px 8px',borderRadius:20,background:C.azulBg,color:C.azulInfo,whiteSpace:'nowrap'}}>cliente: {nm(e.client_id)} → {nm(newCli)}</span>}{catChg&&<span style={{fontSize:9.5,fontWeight:700,padding:'2px 8px',borderRadius:20,background:'#FDF2E7',color:'#9A5B12',whiteSpace:'nowrap'}}>cat: {e.category||'—'} → {newCat}</span>}</div>:null })()}
                  {kind==='act'&&it.via&&(()=>{ const c=it.via==='ot'?{l:'OT exacta',bg:C.greenBg,fg:C.greenText}:it.via==='fecha'?{l:'fecha + monto',bg:C.azulBg,fg:C.azulInfo}:((it.score||0)>=2?{l:'cliente + monto + glosa',bg:C.azulBg,fg:C.azulInfo}:{l:`glosa parcial · ${it.score||0} palabra${(it.score||0)!==1?'s':''}`,bg:C.ambarBg,fg:C.soonText}); return <div><span style={{display:'inline-block',marginTop:3,fontSize:9.5,fontWeight:700,padding:'2px 8px',borderRadius:20,background:c.bg,color:c.fg,whiteSpace:'nowrap'}}>calzó: {c.l}</span></div> })()}
                  {kind==='new'&&<div style={{marginTop:3,fontSize:10,color:C.greenText,fontWeight:600}}>Nuevo{r.categoria?` · ${r.categoria}`:''}{r.paid_by_client!==undefined?<span style={{color:r.paid_by_client?C.soonText:C.accent}}> · {r.paid_by_client?'pagó cliente':'caja chica'}</span>:''}</div>}
                  {(kind==='act'||kind==='new')&&<div onClick={ev=>ev.stopPropagation()} style={{display:'flex',gap:10,alignItems:'center',marginTop:5,flexWrap:'wrap'}}>
                    <select value={CAT_OPCIONES.includes(r.categoria)?r.categoria:''} onChange={e=>editarCampo(r.id,'categoria',e.target.value)} style={{fontSize:10,padding:'3px 6px',borderRadius:6,border:`1px solid ${C.border}`,background:'#fff',color:C.muted,outline:'none'}}><option value=''>Categoría…</option>{CAT_OPCIONES.map(c=><option key={c} value={c}>{c}</option>)}</select>
                    {kind==='act'&&candidatosDe(r).length>1&&<button onClick={()=>setMatchPick(matchPick===r.id?null:r.id)} style={{fontSize:10,fontWeight:600,color:C.azulInfo,background:'none',border:'none',cursor:'pointer',padding:0,textDecoration:'underline'}}>otro calce ({candidatosDe(r).length})</button>}
                    {kind==='act'&&<button onClick={()=>toggleForzar(r.id)} style={{fontSize:10,fontWeight:600,color:C.muted,background:'none',border:'none',cursor:'pointer',padding:0,textDecoration:'underline'}}>tratar como nuevo →</button>}
                    {kind==='new'&&forzarNuevo.has(r.id)&&<button onClick={()=>toggleForzar(r.id)} style={{fontSize:10,fontWeight:600,color:C.azulInfo,background:'none',border:'none',cursor:'pointer',padding:0,textDecoration:'underline'}}><Gl n='chevL'/> volver a calzar</button>}
                  </div>}
                  {kind==='act'&&matchPick===r.id&&<div onClick={ev=>ev.stopPropagation()} style={{marginTop:5,background:'#fff',border:`1px solid ${C.border}`,borderRadius:8,padding:'4px',maxHeight:140,overflowY:'auto'}}>
                    {candidatosDe(r).map(c=>{ const sel=String(c.id)===String(e.id); return <div key={c.id} onClick={()=>{ setConcilMatch(p=>({...p,[r.id]:c.id})); setMatchPick(null) }} style={{padding:'5px 7px',borderRadius:6,cursor:'pointer',background:sel?C.azulBg:'transparent',fontSize:10,color:C.text,lineHeight:1.35}}><b style={{color:C.text}}>{c.concept||'—'}</b><span style={{color:C.muted}}> · {c.category||'—'}{c.date?' · '+String(c.date).slice(0,10):''}{sel?' · actual':''}</span></div> })}
                  </div>}
                  {kind==='sin'&&<div onClick={ev=>ev.stopPropagation()} style={{display:'flex',gap:6,alignItems:'center',flexWrap:'wrap',marginTop:7}}>
                    <div style={{flex:'1 1 150px',minWidth:0}}><AsignarClienteInline bill={{id:r.id}} clients={clients} onAssign={(_,cid)=>asignar(r.id,cid)} label='Asignar cliente'/></div>
                    {r.nombre&&onCreateOccasional&&<button onClick={()=>setOcasPick(ocasPick===r.id?null:r.id)} title={`Crear ocasional "${r.nombre}"`} style={{flexShrink:0,fontSize:11,fontWeight:600,padding:'5px 10px',borderRadius:8,border:`1px solid ${ocasPick===r.id?C.accent:C.border}`,background:'#fff',color:C.accent,cursor:'pointer'}}>+ Ocasional {ocasPick===r.id?<Gl n='chevU'/>:<Gl n='chevD'/>}</button>}
                  </div>}
                  {kind==='sin'&&ocasPick===r.id&&<div onClick={ev=>ev.stopPropagation()} style={{display:'flex',gap:6,flexWrap:'wrap',alignItems:'center',marginTop:6}}>
                    <span style={{fontSize:10,color:C.muted,fontWeight:600}}>«{r.nombre}» · responsable:</span>
                    {['Cristóbal','Erasmo','Martín','Martina','Rodrigo'].map(m=>{const p=personChip(m);return <button key={m} onClick={()=>crearOcasional(r,m)} style={{fontSize:11,borderRadius:20,padding:'3px 10px',fontWeight:600,cursor:'pointer',background:p.bg,color:p.color,border:'none'}}>{m}</button>})}
                    <button onClick={()=>crearOcasional(r,null)} style={{fontSize:11,borderRadius:20,padding:'3px 10px',fontWeight:600,cursor:'pointer',background:C.bgWarm,color:C.grisText,border:'none'}}>Sin responsable</button>
                  </div>}
                  </div>
                </div>
              ) }
              const groupable=(kind==='act'||kind==='new'||kind==='ok'||kind==='rend')&&vis.length>6
              const grupos=(()=>{ const g={}; vis.forEach(it=>{const r=it.r||it; const k=cn(r); (g[k]=g[k]||[]).push(it)}); return Object.entries(g).sort((a,b)=>b[1].length-a[1].length) })()
              return (<div style={{background:'#FBFCFD',maxHeight:320,overflowY:'auto'}}>
                {kind==='rend'&&<label style={{display:'flex',gap:8,alignItems:'flex-start',padding:'9px 13px',cursor:'pointer',borderBottom:`0.5px solid ${C.border}`}}>
                  <input type='checkbox' checked={noTocarRendidos} onChange={e=>setNoTocarRendidos(e.target.checked)} style={{marginTop:2,flexShrink:0}}/>
                  <span style={{fontSize:11,color:C.coralText,lineHeight:1.4}}>No cambiarles el cliente (solo corregir categoría) para no desincronizar su liquidación de caja chica</span>
                </label>}
                {items.length>8&&<input value={concilQ} onChange={e=>setConcilQ(e.target.value)} placeholder='Buscar cliente o concepto…' style={{width:'calc(100% - 20px)',margin:'8px 10px',padding:'6px 10px',borderRadius:8,border:`1px solid ${C.border}`,fontSize:11,outline:'none',boxSizing:'border-box'}}/>}
                {kind==='act'&&items.length>1&&(()=>{ const nc=items.filter(chgCli).length, nt=items.filter(chgCat).length; return (nc>0&&nt>0)?<div style={{display:'flex',gap:6,padding:'2px 10px 8px',flexWrap:'wrap'}}>{[['all','Todas',items.length],['cli','Cambian cliente',nc],['cat','Cambian categoría',nt]].map(([k,l,n])=>{ const on=chgFilter===k; return <button key={k} onClick={()=>setChgFilter(on&&k!=='all'?'all':k)} style={{fontSize:10,padding:'3px 9px',borderRadius:20,cursor:'pointer',border:on?`1px solid ${C.azulInfo}`:`1px solid ${C.border}`,background:on?C.azulBg:'#fff',color:on?C.azulInfo:C.muted,fontWeight:on?600:400}}>{l} {n}</button> })}</div>:null })()}
                {vis.length===0
                  ? <div style={{padding:'14px',fontSize:11,color:C.muted,textAlign:'center'}}>Sin resultados{concilQ?` para «${concilQ}»`:''}</div>
                  : !groupable
                  ? vis.slice(0,300).map(renderItem)
                  : grupos.map(([gname,gitems])=>{ const gkey=kind+'|'+gname; const gopen=concilGrp.has(gkey); const tot=gitems.reduce((s,it)=>s+((it.r||it).monto||0),0); const allOff=selectable&&gitems.every(it=>concilExcl.has(exKeyOf(it))); return (
                    <div key={gname}>
                      <div onClick={()=>toggleGrp(gkey)} style={{display:'flex',alignItems:'center',gap:9,padding:'8px 13px',background:'#EEF2F4',borderTop:`0.5px solid ${C.border}`,cursor:'pointer'}}>
                        {selectable&&<input type='checkbox' checked={!allOff} onClick={ev=>ev.stopPropagation()} onChange={()=>setConcilExcl(p=>{const n=new Set(p); gitems.forEach(it=>{const k=exKeyOf(it); allOff?n.delete(k):n.add(k)}); return n})} style={{flexShrink:0,cursor:'pointer'}}/>}
                        <span style={{flex:1,fontSize:13,fontWeight:700,color:C.accent,minWidth:0,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{gname}</span>
                        <span style={{fontSize:10,color:C.muted,flexShrink:0}}>{gitems.length} · ${tot.toLocaleString('es-CL')}</span>
                        <span style={{fontSize:12,color:C.textSoft,flexShrink:0}}>{gopen?'⌃':<Gl n='chevron'/>}</span>
                      </div>
                      {gopen&&gitems.map(renderItem)}
                    </div>
                  )})}
              </div>)
            }
            const avisos=[
              {k:'ok', t:'Ya cargados · sin cambios', n:concil.yaCorrecto.length, col:C.greenText, items:concil.yaCorrecto},
              {k:'rend', t:'Ya liquidados · protegidos', n:rend.length, col:C.coralText, items:rend},
              {k:'sin', t:'Quedan sin cliente', n:sinCli.length, col:C.overdueText, items:sinCli},
              {k:'dup', t:'Duplicados del archivo · se omite 1', n:dups.length, col:C.soon, items:dups},
            ].filter(s=>s.n>0)
            const tileOpen = concilOpen==='act'||concilOpen==='new'
            const resto = (
            <div style={{marginBottom:10}}>
              <div style={{fontSize:12,color:'#26424E',background:C.azulBg,borderRadius:10,padding:'10px 12px',marginBottom:10,lineHeight:1.5}}>De <b>{rows.length} filas</b>: <b>{nCorr} por corregir</b>{concil.yaCorrecto.length>0?<>, <b>{concil.yaCorrecto.length} ya cargadas</b></>:''}, <b>{nNuev} nuevas</b>{concil.posibles.length>0?<> y <b style={{color:'#9A5B12'}}>{concil.posibles.length} posibles duplicados</b> a revisar</>:''}. Destilda las que no quieras; haz una parte ahora y otra después — al re-subir retoma sin duplicar ni rehacer lo hecho.</div>
              {tipo!=='fondo'&&<div style={{display:'flex',gap:6,alignItems:'center',flexWrap:'wrap',marginBottom:10}}>
                <span style={{fontSize:10,fontWeight:700,color:C.textSoft,textTransform:'uppercase',letterSpacing:'.4px'}}>Caja chica de</span>
                <button onClick={()=>{setCajaOwner('');setCajaElegida(true)}} style={{fontSize:11,fontWeight:600,padding:'4px 11px',borderRadius:20,cursor:'pointer',border:cajaOwner===''?`1px solid ${C.accent}`:`1px solid ${C.border}`,background:cajaOwner===''?C.bgSoft:'#fff',color:cajaOwner===''?C.accent:C.muted}}>— Ninguno</button>
                {['Cristóbal','Erasmo','Martín','Martina','Rodrigo'].map(m=>{ const pc=personChip(m); const on=cajaOwner===m; return <button key={m} onClick={()=>{setCajaOwner(on?'':m);setCajaElegida(true)}} style={{fontSize:11,fontWeight:600,padding:'4px 11px',borderRadius:20,cursor:'pointer',border:on?`1px solid ${pc.color}`:`1px solid ${C.border}`,background:on?pc.bg:'#fff',color:on?pc.color:C.muted}}>{m}</button> })}
                {cajaOwner&&<span style={{fontSize:10,color:C.greenText,fontWeight:600,flexBasis:'100%'}}>Los gastos nuevos quedan a su nombre → entran a su caja chica.</span>}
              </div>}
              {/* Tiles: el resultado de la carga */}
              <div style={{display:'flex',gap:8,marginBottom:tileOpen?0:10}}>
                {[['act','Corregir',nCorr,C.azulInfo,C.azulBg,'cambian algo'],['new','Nuevos',nNuev,C.greenText,C.greenBg,'a importar']].map(([k,l,n,col,bg,h])=>{ const on=concilOpen===k; return (
                  <div key={k} onClick={()=>setConcilOpen(on?null:k)} style={{flex:1,background:bg,borderRadius:on?'12px 12px 0 0':12,padding:'12px',cursor:'pointer',border:`1px solid ${on?col:bg}`,borderBottom:on?'none':`1px solid ${bg}`}}>
                    <div style={{fontSize:25,fontWeight:800,color:col,lineHeight:1}}>{n}</div>
                    <div style={{fontSize:11,fontWeight:700,color:col,textTransform:'uppercase',letterSpacing:'.03em',marginTop:3}}>{l}</div>
                    <div style={{fontSize:10,color:col,opacity:.8,marginTop:2}}>{h}</div>
                  </div>
                )})}
              </div>
              {tileOpen&&<div style={{border:`1px solid ${C.border}`,borderTop:'none',borderRadius:'0 0 12px 12px',overflow:'hidden',marginBottom:10}}>{lista(concilOpen==='act'?concil.corregir:concil.nuevos, concilOpen)}</div>}
              {concil.posibles.length>0&&<div style={{background:'#fff',border:`1px solid ${C.border}`,borderRadius:12,overflow:'hidden',marginBottom:10}}>
                <div onClick={()=>setPosOpen(o=>!o)} style={{display:'flex',alignItems:'center',gap:10,padding:'10px 12px',cursor:'pointer',background:posOpen?'#FEF6EE':'#fff'}}>
                  <span style={{width:9,height:9,borderRadius:'50%',background:C.soon,flexShrink:0}}/>
                  <span style={{flex:1,fontSize:13,fontWeight:600,color:C.text,minWidth:0}}>Posibles duplicados<span style={{display:'block',fontSize:10,color:C.muted,fontWeight:400}}>mismo cliente y monto · glosa o fecha distinta</span></span>
                  <span style={{fontSize:14,fontWeight:700,color:C.soonText}}>{concil.posibles.length}</span>
                  <span style={{fontSize:13,color:C.textSoft}}>{posOpen?'⌃':<Gl n='chevron'/>}</span>
                </div>
                {posOpen&&<div style={{background:'#FBFCFD',maxHeight:340,overflowY:'auto'}}>
                  {concil.posibles.map((p,j)=>{ const r=p.r, e=p.e; const dec=posibleDec[r.id]; const exp=posExp===r.id; const cliName=(clients.find(c=>String(c.id)===String(r.client_id))||{}).name||r.clientName||r.nombre||'—'; const newCat=tipo==='fondo'?'Fondo':(r.categoria||e.category); const glosaEq=String((r.concepto||'').toLowerCase().trim())===String((e.concept||'').toLowerCase().trim()); const bdg=dec==='omitir'?{l:'omitido',bg:C.greenBg,fg:C.greenText}:dec==='cargar'?{l:'se carga',bg:C.azulBg,fg:C.azulInfo}:{l:'posible',bg:'#FEF6EE',fg:C.soonText}; return (
                    <div key={r.id} style={{borderTop:j?`0.5px solid ${C.border}`:'none',opacity:dec==='omitir'?.55:1}}>
                      <div onClick={()=>setPosExp(exp?null:r.id)} style={{display:'flex',alignItems:'center',gap:9,padding:'9px 13px',cursor:'pointer'}}>
                        <div style={{flex:1,minWidth:0}}>
                          <div style={{fontSize:12,fontWeight:600,color:C.text,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',textDecoration:dec==='omitir'?'line-through':'none'}}>{cliName} · {r.concepto||'—'}</div>
                          <div style={{fontSize:10,color:C.muted}}>{r.fecha?String(r.fecha).slice(0,10):'sin fecha'}{newCat?' · '+newCat:''}</div>
                        </div>
                        <span style={{fontSize:12,fontWeight:700,color:C.text,flexShrink:0}}>{fmt(r.monto)}</span>
                        <span style={{fontSize:9,fontWeight:700,textTransform:'uppercase',letterSpacing:'.2px',padding:'2px 7px',borderRadius:10,flexShrink:0,background:bdg.bg,color:bdg.fg}}>{bdg.l}</span>
                        <span style={{fontSize:12,color:C.textSoft,flexShrink:0}}>{exp?'⌃':<Gl n='chevron'/>}</span>
                      </div>
                      {exp&&<div style={{background:'#fff',padding:'8px 13px 11px',borderTop:`0.5px solid ${C.border}`,fontSize:11,lineHeight:1.5}}>
                        <div style={{display:'flex',gap:8,marginBottom:3}}><span style={{color:C.muted,minWidth:64}}>Cliente</span><b style={{color:C.greenText}}>{cliName}</b><span style={{color:C.muted}}>= mismo</span></div>
                        <div style={{display:'flex',gap:8,marginBottom:3}}><span style={{color:C.muted,minWidth:64}}>Monto</span><b style={{color:C.greenText}}>{fmt(r.monto)}</b><span style={{color:C.muted}}>= en sistema</span></div>
                        <div style={{display:'flex',gap:8,marginBottom:3,minWidth:0}}><span style={{color:C.muted,minWidth:64,flexShrink:0}}>Glosa</span><b style={{color:glosaEq?C.greenText:C.overdue,minWidth:0,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{r.concepto||'—'}</b><span style={{color:C.muted,flexShrink:0}}>{glosaEq?'= igual':`≠ "${(e.concept||'—').slice(0,24)}"`}</span></div>
                        <div style={{display:'flex',gap:8,marginBottom:8}}><span style={{color:C.muted,minWidth:64}}>En sistema</span><span style={{color:C.muted}}>Ya cargado{e.date?' · '+String(e.date).slice(0,10):''}{e.rendered_at?' · caja chica':''}</span></div>
                        <div style={{display:'flex',gap:8}}>
                          <button onClick={()=>setPosibleDec(d=>({...d,[r.id]:dec==='omitir'?undefined:'omitir'}))} style={{flex:1,fontSize:11,fontWeight:700,borderRadius:8,padding:'7px',cursor:'pointer',border:dec==='omitir'?`1px solid ${C.greenText}`:`1px solid ${C.border}`,background:dec==='omitir'?C.greenBg:'#fff',color:dec==='omitir'?C.greenText:C.muted}}>Es el mismo · omitir</button>
                          <button onClick={()=>setPosibleDec(d=>({...d,[r.id]:dec==='cargar'?undefined:'cargar'}))} style={{flex:1,fontSize:11,fontWeight:700,borderRadius:8,padding:'7px',cursor:'pointer',border:'none',background:dec==='cargar'?C.azulInfo:C.greenText,color:'#fff'}}>Es otro · cargar igual</button>
                        </div>
                      </div>}
                    </div>
                  )})}
                </div>}
              </div>}
              {avisos.length>0&&<div style={{background:'#fff',border:`1px solid ${C.border}`,borderRadius:12,overflow:'hidden',marginBottom:10}}>
                {avisos.map((s,i)=>{ const open=concilOpen===s.k; return (
                  <div key={s.k} style={{borderTop:i?`0.5px solid ${C.border}`:'none'}}>
                    <div onClick={()=>setConcilOpen(open?null:s.k)} style={{display:'flex',alignItems:'center',gap:10,padding:'10px 12px',cursor:'pointer',background:open?C.bgSoft:'#fff'}}>
                      <span style={{width:9,height:9,borderRadius:'50%',background:s.col,flexShrink:0}}/>
                      <span style={{flex:1,fontSize:13,fontWeight:600,color:C.text,minWidth:0}}>{s.t}</span>
                      <span style={{fontSize:14,fontWeight:700,color:s.col}}>{s.n}</span>
                      <span style={{fontSize:13,color:C.textSoft,flexShrink:0}}>{open?'⌃':<Gl n='chevron'/>}</span>
                    </div>
                    {open&&lista(s.items,s.k)}
                  </div>
                )})}
              </div>}
              
              <div style={{display:'flex',gap:8,marginTop:2}}>
                {(()=>{ const dud=corregirSel().filter(a=>a.via==='cliente'&&(a.score||0)<2).length; const needRev=dud>0&&concilOpen!=='act'; return <button disabled={guardando||nCorr===0} onClick={()=>needRev?setConcilOpen('act'):aplicarCorregir()} title={needRev?'Revisa los calces por glosa parcial antes de guardar':''} style={{flex:1,padding:'11px 8px',borderRadius:8,fontSize:13,fontWeight:700,cursor:nCorr?'pointer':'default',border:'none',background:needRev?C.soonText:C.azulInfo,color:'#fff',opacity:(guardando||!nCorr)?.5:1}}>{guardando?'…':(nCorr?(needRev?`Revisar ${dud} dudosos`:`Corregir las ${nCorr}`):'Nada que corregir')}</button> })()}
                <button disabled={guardando||nNuev===0} onClick={aplicarImportar} style={{flex:1,padding:'11px 8px',borderRadius:8,fontSize:13,fontWeight:700,cursor:nNuev?'pointer':'default',border:'none',background:C.greenText,color:'#fff',opacity:(guardando||!nNuev)?.5:1}}>{guardando?'…':`Importar las ${nNuev}`}</button>
              </div>
            </div>
            )
    const acc = (nCorr>0||nNuev>0||concil.posibles.length>0)&&(()=>{ const posPend=posiblesPend(); const sel=corregirSel(); const cliN=sel.filter(({r,e,rendido})=>!(rendido&&noTocarRendidos)&&String(e.client_id||'')!==String(r.client_id||e.client_id||'')).length; const catN=sel.filter(({r,e})=>String(e.category||'')!==String((tipo==='fondo'?'Fondo':(r.categoria||e.category))||'')).length; const totC=sel.reduce((s,a)=>s+(a.r.monto||0),0); const totN=nuevosSel().reduce((s,r)=>s+(r.monto||0),0); const dud=sel.filter(a=>a.via==='cliente'&&(a.score||0)<2).length; const xMonto=rows.length-(concil.actualizar.length+concil.nuevos.length+concil.posibles.length); return <div style={{fontSize:11,color:C.muted,marginBottom:8,lineHeight:1.5,background:C.bgSoft,borderRadius:8,padding:'7px 10px'}}>{nCorr>0&&<div>Al corregir: <b style={{color:C.azulInfo}}>{cliN}</b> cambian cliente · <b style={{color:'#9A5B12'}}>{catN}</b> cambian categoría · {fmt(totC)}</div>}{nNuev>0&&<div style={{marginTop:nCorr>0?2:0}}>Al importar: <b style={{color:C.greenText}}>{nNuev}</b> gastos nuevos · {fmt(totN)}</div>}{dud>0&&<div style={{marginTop:3,color:C.soonText,fontWeight:600}}>● {dud} calzaron por glosa parcial — conviene revisarlos antes</div>}{posPend>0&&<div style={{marginTop:3,color:C.soonText,fontWeight:600}}>● {posPend} posible{posPend!==1?'s':''} duplicado{posPend!==1?'s':''} sin decidir — revísalos arriba</div>}<div style={{marginTop:4,paddingTop:4,borderTop:`0.5px solid ${C.border}`,color:C.textSoft}}>{rows.length} filas = {concil.corregir.length} corregir + {concil.yaCorrecto.length} ya OK + {concil.nuevos.length} nuevas{concil.posibles.length>0?` + ${concil.posibles.length} posibles`:''}{xMonto>0?` + ${xMonto} sin monto`:''}</div></div> })()
    return part==='resto'?resto:part==='acc'?acc:<>{resto}{acc}</>
  }
  return (
    <>
      {/* Paso 1: tipo + subir archivo */}
      {!rows&&(
        <>
          {notaria&&archivoCorreo&&!cargando&&!rows&&<AutoClick sel="[data-analizar-correo='1']" clave={`analizar:${archivoCorreo.path||archivoCorreo.nombre||''}`}/>}
          {notaria&&archivoCorreo&&!cargando&&<div style={{display:'flex',alignItems:'center',gap:10,padding:'11px 14px',borderRadius:12,border:`1px solid ${C.border}`,background:C.card,marginBottom:10}}>
            <div style={{flex:1,minWidth:0}}><div style={{fontSize:13,fontWeight:700,color:C.accent}}>Liquidación recibida por correo</div><div style={{fontSize:11.5,color:C.textSoft,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{archivoCorreo.nombre}</div></div>
            <button data-analizar-correo='1' onClick={async()=>{ try{ const {data,error}=await supabase.storage.from('documentos').download(archivoCorreo.path); if(error||!data) throw (error||new Error('sin archivo')); await onFile({target:{files:[new File([data],archivoCorreo.nombre,{type:data.type||'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'})]}}) }catch(e){ appAlert('No se pudo abrir el archivo del correo: '+(e.message||e)) } }} style={{fontSize:12.5,fontWeight:700,color:'#fff',background:C.accent,border:'none',borderRadius:9,padding:'7px 14px',cursor:'pointer',whiteSpace:'nowrap'}}>Analizar</button>
          </div>}
          {notaria
            ? <label style={{display:'block',padding:'26px 24px',borderRadius:12,border:`2px dashed ${C.border}`,textAlign:'center',cursor:'pointer',background:C.bgPanel,marginBottom:12}}>
                <input type='file' accept='.xlsx,.xls' onChange={onFile} style={{display:'none'}}/>
                <div style={{fontSize:15,color:C.accent,fontWeight:700}}>{cargando?'Leyendo…':'Cargar Excel de notaría'}</div>
                <div style={{fontSize:11,color:C.muted,marginTop:3}}>.xlsx · categoría Notaría automática</div>
              </label>
            : <div style={{display:'flex',gap:9,marginBottom:12}}>
                {[['gasto','Cargar gastos','Gastos del cliente'],['fondo','Cargar fondos','Abonos a fondo']].map(([v,t,h])=>(
                  <label key={v} onClick={()=>setTipo(v)} style={{flex:1,border:`1px solid ${C.border}`,borderRadius:12,padding:'20px 10px',textAlign:'center',cursor:'pointer',background:C.bgPanel}}>
                    <input type='file' accept='.xlsx,.xls' onChange={onFile} style={{display:'none'}}/>
                    <div style={{fontSize:14,fontWeight:700,color:C.accent}}>{cargando?'Leyendo…':t}</div>
                    <div style={{fontSize:11,color:C.muted,marginTop:3}}>{h}</div>
                  </label>
                ))}
              </div>}
        </>
      )}

      {/* Paso 2: vista previa (escritorio: lista a la izquierda, foto + filtros + botones fijos a la derecha) */}
      {rows&&(
        isDeskCM ? (
          <div style={{display:'flex',alignItems:'stretch',gap:18,height:'calc(100vh - 160px)',minHeight:420}}>
            <div style={{flex:1,minWidth:0,overflowY:'auto',paddingRight:6}}>{cmMatching}{concilUI('resto')}{cmDups}{cmList}</div>
            <div style={{width:330,flexShrink:0,display:'flex',flexDirection:'column',gap:10,overflowY:'auto'}}>
              {cmAlarm}{cmHero}{cmBuckets}{cmSel}{cmActs}{concilUI('acc')}
              <button onClick={()=>setRows(null)} style={{width:'100%',padding:11,borderRadius:10,border:`1px solid ${C.border}`,background:'transparent',color:C.muted,fontSize:13,fontWeight:600,cursor:'pointer'}}>Volver a subir otro archivo</button>
            </div>
          </div>
        ) : (<>
          {cmAlarm}{cmHero}{cmBuckets}{cmMatching}{concilUI()}{cmActs}{cmDups}{cmList}
          <button onClick={()=>setRows(null)} style={{width:'100%',padding:11,borderRadius:10,border:`1px solid ${C.border}`,background:'transparent',color:C.muted,fontSize:13,fontWeight:600,cursor:'pointer'}}>Volver a subir otro archivo</button>
        </>)
      )}
    </>
  )
}

