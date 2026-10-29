// Base compartida de la app: paleta, marca, formatos, iconos, diálogos y el interruptor móvil↔escritorio.
// Todo lo que cualquier pantalla necesita vive aquí para que las pantallas puedan salir de App.jsx y cargarse por separado.
import { useState, useEffect, lazy, Suspense } from 'react'

// Paleta corporativa. soon (#C77F18) = ámbar oficial de aviso: único color cálido permitido,
// para estados Propuesta/Prospecto/Borrador, próximo a vencer y costo de terceros.
export const C = {
  bg:'#F5F5F5',surface:'#FFFFFF',card:'#FFFFFF',border:'#E4E8EB',text:'#3D3D3D',muted:'#537281',
  accent:'#003C50',overdue:'#E24B4A',urgent:'#E24B4A',soon:'#C77F18',normal:'#1D9E75',done:'#99ABB4',
  // texto secundario chico (auditoría visual 2026-10-15, punto 5): 'done' (#99ABB4) da 2,4:1 sobre blanco; textSoft da 4,9:1. 'done' queda para líneas, íconos y desactivados.
  textSoft:'#60747F',
  // verde oscuro para TEXTO/cifras sobre fondos verde claro (#E1F5EE) — legible donde 'normal' (#1D9E75) quedaría bajo de contraste
  greenText:'#0F6E56',
  // track "off" de los switches (gris-azul suave, deliberadamente más claro que 'done')
  toggleOff:'#CBD5DB',
  // tints canónicos de estado (consolidados): fondo + texto para ámbar/rojo/verde
  soonBg:'#FFF8E1', soonText:'#854F0B', overdueBg:'#FCEBEB', overdueText:'#A32D2D', greenBg:'#E1F5EE', greenSoft:'#EFF9F5', greenDeep:'#C9EEDF',
  azulInfo:'#185FA5', azulBg:'#E6F1FB', azulBd:'#D5E6F6', overdueBd:'#F3D2D0', tealBg:'#DFF1F2', tealText:'#155E6B', ambarBg:'#FAEEDA', coralText:'#993C1D', grisText:'#5F5E5A',
  // grises de fondo (antes hex sueltos repetidos): bgSoft = filas/hover/chips suaves; bgPanel = paneles internos; bgWarm = chips neutros cálidos. Migrar los literales a estos al tocar cada vista.
  bgSoft:'#F5F7F9', bgPanel:'#FAFBFC', bgWarm:'#F1EFE8',
  // pista/fondo gris-azul de barras, chips y celdas neutras (antes #EEF1F3 suelto ×45)
  track:'#EEF1F3',
  // tiles del grid del Inicio (kTile): fondo, borde y borde-abierto
  tileBg:'#FFFFFF', tileLine:'#E4E8EB', tileLineOn:'#CFE0E6', selBg:'#F3F8FC',   // selBg: fila seleccionada (celeste muy tenue)
    // tarjetas: mismo blanco y borde que Accesos directos (más contraste con la página)
  // sub-paleta SOBRE NAVY (heroes con fondo accent #003C50, p.ej. Saldo del cliente / Vendido): label azul claro, botón navy profundo, divisor, verde/rojo claros legibles sobre navy
  onNavyLabel:'#85B7EB', onNavyBtn:'#0E5066', onNavyLine:'#1C5468', onNavyGreen:'#9BD9BE', onNavyRed:'#F0A3A3',
  // tenues con letra oscura: chips y botón de guardar (azul) y avisos en línea (crema + café)
  azulTenue:'#EFF5FA', azulTenueOn:'#E3EDF5', avisoBg:'#FFFBF0', avisoLine:'#F3E2BC', avisoMid:'#FBF1DE', avisoText:'#633806',
}

// ── BRAND — identidad del ESTUDIO (tenant). LEA es el tenant #1. Todo lo identitario se lee de aquí
// para poder adaptar a OTRO estudio cambiando SOLO esta config (regla de oro: vendible por diseño).
// Inicializado con los valores actuales de LEA → cero cambio visible. Migración de literales, gradual.
export const BRAND = {
  nombre: 'Liberona Escala Abogados',
  nombreLegal: 'Liberona Escala Abogados Limitada',
  nombreLegalCorto: 'Liberona Escala Abogados Ltda.',
  rut: '77.700.387-9',
  // Host de la app (links/logos absolutos en correos). Runtime: cada dominio se auto-describe (gestion.leabogados.cl o firmdesk.legal),
  // porque el MISMO deploy sirve ambos → una env var no serviría. Fallback a gestion en localhost / previews de Vercel. LEA queda idéntico.
  dominio: (typeof window!=='undefined' && window.location && window.location.host && !/^localhost|^127\.|\.vercel\.app$/i.test(window.location.host)) ? window.location.host : 'gestion.leabogados.cl',
  web: 'leabogados.cl',
  emailDominio: 'leabogados.cl',   // dominio de las cuentas del equipo (aviso de reingreso cuando un correo no sale)
  notaria: 'Notaría',
  casillaAgente: '',                 // casilla que lee el agente de administración (learnings config 'agente_casilla'): va en copia en solicitudes de fondos y rendiciones para que la respuesta del cliente (comprobante) le llegue
  ccNotaria: '',                     // copia del estudio en los correos a la notaría (configurable: estudios.cc_notaria; antes escrito fijo en 4 lugares)                // notaría con que trabaja el estudio (configurable: estudios.notaria_nombre; LEA = 'Notaría Lascar')
  cajaChicaUmbral: 50000,            // aviso "Caja chica baja" cuando el saldo de un miembro queda en o bajo este monto (configurable por estudio: estudios.caja_chica_umbral)
  portal: 'portal.leabogados.cl',                   // dominio del portal del cliente
  direccion: 'Av. Pdte. Kennedy 7900, Of. 905, Vitacura · Santiago',
  direccionCalle: 'Av. Pdte. Kennedy 7900, Of. 905, Vitacura',    // variante corta (factura PDF / footers / comprobantes) — texto EXACTO del DTE registrado en el SII
  direccionFirma: 'Av. Pdte. Kennedy 7900, Of. 905, Vitacura',    // variante membrete/firma de correo
  ciudad: 'Santiago',
  telefono: '+56 2 2405 3800',
  telefonoFactura: '+56991556769',   // el que imprime la factura (PDF del DTE)
  siiUnidad: 'S.I.I. - SANTIAGO ORIENTE',   // unidad del SII del emisor (recuadro del PDF)
  socios: 'Cristóbal Liberona y Erasmo Escala',
  logo: { blanco:'/le-logo-blanco.png', color:'/le-logo-color.png', full:'/le-logo-full-blanco.png' },
  // Datos de cobro (transferencia). Fuente ÚNICA — CUENTA_HONORARIOS/CUENTA_GASTOS y todo texto de pago leen de aquí.
  pago: {
    honorarios: { banco:'Banco BICE', cuenta:'1403834', email:'contacto@leabogados.cl' },
    gastos:     { banco:'Banco BICE', cuenta:'1383922', cuentaFmt:'138392-2', email:'administracion@leabogados.cl' },
    dolares:    { banco:'Banco BICE', cuenta:'01301087698', moneda:'USD', email:'contacto@leabogados.cl' },
  },
}

// ── MÓDULOS (catálogo) + entitlements por estudio. Habilitador de la venta por módulos.
// HOY: todo habilitado para LEA → cero cambio. FUTURO (Fase 3): habilitados por estudio_id.
export const MODULOS = [
  { id:'nucleo', label:'Núcleo', core:true }, { id:'horas', label:'Horas & Rentabilidad' },
  { id:'finanzas', label:'Finanzas' }, { id:'sii', label:'Facturación SII' },
  { id:'gastos', label:'Gastos & Rendiciones' }, { id:'proyectos', label:'Proyectos' },
  { id:'bi', label:'Inteligencia' }, { id:'ialegal', label:'IA Legal' }, { id:'portal', label:'Portal del Cliente' },
]

export const MODULOS_CORE = new Set(MODULOS.filter(m=>m.core).map(m=>m.id))   // Núcleo: nunca se apaga

export const MODULOS_OFF = new Set()   // se hidrata desde learnings 'fd_modulo_off' al iniciar; vacío = todo ON (LEA)

export const moduloOn = id => !id || MODULOS_CORE.has(id) || !MODULOS_OFF.has(id)   // core siempre ON; el resto ON salvo apagado explícito

export const fmt = n => new Intl.NumberFormat('es-CL',{style:'currency',currency:'CLP',maximumFractionDigits:0}).format(n||0).replace(/^-/,'−')   // signo menos tipográfico

// Fecha DD-MM-AAAA a partir de un ISO 'AAAA-MM-DD'
export const fmtFechaDMY = d => { if(!d) return '—'; const p=String(d).slice(0,10).split('-'); return p.length===3?`${p[2]}-${p[1]}-${p[0]}`:String(d) }

// Monto en CLP en valor absoluto (sin signo): el llamador agrega el +/- cuando corresponde. Fuente única para PDFs/resúmenes.
export const fmtN = n => '$' + Math.abs(n||0).toLocaleString('es-CL')

export const SEC_LBL = {fontSize:10,fontWeight:700,letterSpacing:.5,textTransform:'uppercase',color:C.accent}

// RUT chileno con puntos y guion (12.345.678-9). Idempotente; si el texto no parece un RUT lo deja igual.
export const fmtRutCL = r => { const t=String(r??'').trim(); if(!/^[0-9.\s]+-?\s*[0-9kK]$/.test(t)) return t; const c=t.replace(/[^0-9kK]/g,'').toUpperCase(); return c.slice(0,-1).replace(/\B(?=(\d{3})+(?!\d))/g,'.')+'-'+c.slice(-1) }

export const isoLocal = ts => { const d=ts?new Date(ts):null; if(!d||isNaN(d)) return ''; return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}` }

export const diaGrande = (d,col) => { const M=['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic']; const s=String(d||'').slice(0,10).split('-'); if(s.length<3||!s[2]) return <div style={{width:44,flexShrink:0,textAlign:'center',lineHeight:1.15,fontSize:9,color:C.textSoft,fontWeight:600}}>sin<br/>fecha</div>; return <div style={{width:44,flexShrink:0,textAlign:'center',lineHeight:1.05}}><div style={{fontSize:18,fontWeight:700,color:col||C.accent}}>{+s[2]}</div><div style={{fontSize:10,color:C.muted,fontWeight:600,whiteSpace:'nowrap'}}>{M[+s[1]-1]||''} {s[0].slice(2)}</div></div> }

// Iconos SVG inline (la app NO tiene Tabler; iconos como SVG stroke, estilo Feather). Set mínimo para las secciones de la ficha.
export const _ICON_PATHS = {
  sparkle:'M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5L18 18M6 18l2.5-2.5M15.5 8.5L18 6',
  building:'M5 21V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16M3 21h18M9 7h1M9 11h1M9 15h1M14 7h1M14 11h1M14 15h1',
  file:'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M16 13H8M16 17H8',
  cal:'M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zM16 2v4M8 2v4M3 10h18',
  briefcase:'M20 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2zM16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16',
  wallet:'M3 6h17a1 1 0 0 1 1 1v11a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h13M17 13h.01',
  check:'M9 11l3 3L22 4M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11',
  users:'M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 11a4 4 0 0 1 0-8 4 4 0 0 1 0 8zM23 21v-2a4 4 0 0 0-3-3.87M16 3.1a4 4 0 0 1 0 7.7',
  id:'M3 5h18a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1zM2 10h20M6 15h4',
  mail:'M4 4h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zM22 7l-10 6L2 7',
  exchange:'M17 1l4 4-4 4M3 11V9a4 4 0 0 1 4-4h14M7 23l-4-4 4-4M21 13v2a4 4 0 0 1-4 4H3',
  clock:'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zM12 7v5l3 2',
  alert:'M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h16.9a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0zM12 9v4M12 17h.01',
  x:'M18 6L6 18M6 6l12 12',
  grid:'M3 3h7v7H3zM14 3h7v7h-7zM14 14h7v7h-7zM3 14h7v7H3z',
  receipt:'M5 3v18l2-1 2 1 2-1 2 1 2-1 2 1V3l-2 1-2-1-2 1-2-1-2 1-2-1zM8 9h8M8 13h6',
  user:'M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z',
  chart:'M3 3v18h18M18 9l-5 5-3-3-3 3',
  chevron:'M9 6l6 6-6 6',
  search:'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM21 21l-4.35-4.35',
  download:'M12 3v12m0 0-4-4m4 4 4-4M4 20h16',
  arrowUp:'M12 19V5M6 11l6-6 6 6',
  arrowDown:'M12 5v14M6 13l6 6 6-6',
  // Tarjetas KPI (render aprobado 2026-10-15): un ícono por concepto, el mismo en todas las vistas
  tCobrar:'M12 3v11M7.5 9.5 12 14l4.5-4.5M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3',
  tFavor:'M5.5 6h13A2.5 2.5 0 0 1 21 8.5v8a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 16.5v-8A2.5 2.5 0 0 1 5.5 6zM3 10h18M16 15h2',
  tCero:'M12 3.5a8.5 8.5 0 1 0 0 17a8.5 8.5 0 1 0 0-17M8.5 10.5h7M8.5 13.5h7',
  tPct:'M12 3.5a8.5 8.5 0 1 0 0 17a8.5 8.5 0 1 0 0-17M9 15l6-6M9.3 9.3h.01M14.7 14.7h.01',
  tCheck:'M12 3.5a8.5 8.5 0 1 0 0 17a8.5 8.5 0 1 0 0-17M8.3 12.3l2.5 2.5 5-5.3',
  tPagar:'M5 19 19 5M9 5h10v10',
  tEspera:'M7 3h10M7 21h10M8 3c0 4 8 5 8 9s-8 5-8 9M16 3c0 4-8 5-8 9s8 5 8 9',
  tEntra:'M9 4a5 5 0 1 0 0 10a5 5 0 1 0 0-10M14.5 10.2A5 5 0 1 1 10.2 18M19 3v4h-4',
  tSinFac:'M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8zM14 3v5h5M9.5 13.5l5 5M14.5 13.5l-5 5',
  tIdentif:'M10.5 4a6.5 6.5 0 1 0 0 13a6.5 6.5 0 1 0 0-13M15.5 15.5 20 20M8.8 9a1.8 1.8 0 1 1 2.6 1.6c-.6.3-.9.7-.9 1.3M10.5 14h.01',
  tEnlazar:'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1',
  tBanco:'M3 9.5 12 4l9 5.5M5 10v7M10 10v7M14 10v7M19 10v7M3 20h18',
  // Glifos de navegación (auditoría visual 2026-10-15, punto 7): reemplazan › ▾ ▴ × ← ‹ ✓ escritos como caracteres
  chevD:'M6 9l6 6 6-6',
  chevU:'M6 15l6-6 6 6',
  chevL:'M15 6l-6 6 6 6',
  back:'M20 12H4M10.5 18.5 4 12l6.5-6.5',
  tick:'M5 12.5l4.5 4.5L19 7.5',
}

// Glifo inline: mide 1em y toma el color del texto donde va (reemplaza los caracteres ›, ▾, ×, ←, ✓ para que se vean iguales en iPhone y Windows).
export const Gl = ({n,w=2.2}) => <svg width='1em' height='1em' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth={w} strokeLinecap='round' strokeLinejoin='round' style={{display:'inline-block',verticalAlign:'-0.14em',flexShrink:0}} aria-hidden='true'><path d={_ICON_PATHS[n]}/></svg>

export const SIcon = ({n,s=16,c}) => <svg width={s} height={s} viewBox='0 0 24 24' fill='none' stroke={c||C.muted} strokeWidth='1.7' strokeLinecap='round' strokeLinejoin='round' style={{flexShrink:0}}><path d={_ICON_PATHS[n]||''}/></svg>

// ─── Conciliación de facturas: motor de cruce + auto-generación de conocimiento ───
// Normaliza texto (sin tildes/símbolos) y mide similitud por tokens (Jaccard) 0..1, para cruzar glosa↔proyecto.
export const _normTxt = s => (s||'').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/[^a-z0-9 ]/g,' ').replace(/\s+/g,' ').trim()

// Folio limpio: invoice_no a veces trae la palabra "Factura" como texto; folioN devuelve solo el número/código (para contextos con prefijo "F°").
export const folioN = no => String(no||'').replace(/^factura\s*/i,'').trim()

// Color de pill por persona = FUENTE ÚNICA del color por integrante (CART_AV deriva de acá). Canon 2026-06-27:
// Cristóbal navy · Erasmo oro/mostaza · Martín verde · Martina rojo/rosa · Rodrigo terracota (Erasmo NO azul, para no confundirse con el navy de Cristóbal).
export const PERSON_CHIP = {
  'Cristóbal':{bg:C.azulBg,color:C.accent}, 'Erasmo':{bg:'#F3EFD8',color:'#74600E'},
  'Martín':{bg:'#EAF3DE',color:'#3B6D11'}, 'Martina':{bg:C.overdueBg,color:C.overdueText}, 'Rodrigo':{bg:'#F7E7E1',color:'#A8472A'},
}

export const personChip = n => PERSON_CHIP[(n||'').trim()] || {bg:C.bgWarm,color:C.grisText}

export const Spin = () => <div style={{width:20,height:20,border:`2px solid ${C.border}`,borderTopColor:C.accent,borderRadius:'50%',animation:'spin .7s linear infinite'}}/>

// ── Diálogos propios (reemplazan alert/confirm/prompt nativos, que muestran el dominio en el navegador) ──
let _dialogHost = null

export function appConfirm(opts){ const o = typeof opts==='string'?{message:opts}:(opts||{}); return _dialogHost ? _dialogHost({...o, kind:'confirm'}) : Promise.resolve(window.confirm(o.message)) }

export function appAlert(opts){ const o = typeof opts==='string'?{message:opts}:(opts||{}); return _dialogHost ? _dialogHost({...o, kind:'alert'}) : Promise.resolve(window.alert(o.message)) }

export function appPrompt(opts, def){ const o = typeof opts==='string'?{message:opts, def}:(opts||{}); return _dialogHost ? _dialogHost({...o, kind:'prompt'}) : Promise.resolve(window.prompt(o.message, o.def||'')) }

// ─── Viewport: interruptor único móvil↔escritorio (Fase 0). matchMedia, SSR-safe. Breakpoint 1024px. ──
export const DESKTOP_MQ = '(min-width: 1024px)'

export function useIsDesktop(){
  const [d,setD] = useState(()=> typeof window!=='undefined' && !!window.matchMedia && window.matchMedia(DESKTOP_MQ).matches)
  useEffect(()=>{
    if(typeof window==='undefined' || !window.matchMedia) return
    const mq = window.matchMedia(DESKTOP_MQ)
    const h = e => setD(e.matches)
    setD(mq.matches)
    mq.addEventListener ? mq.addEventListener('change',h) : mq.addListener(h)
    return ()=> mq.removeEventListener ? mq.removeEventListener('change',h) : mq.removeListener(h)
  },[])
  return d
}

// Cuentas del estudio (fuente única). Honorarios: fija. Gastos: default editable/recordado por el usuario.
export const CUENTA_HONORARIOS = { razon:BRAND.nombreLegal, rut:BRAND.rut, banco:BRAND.pago.honorarios.banco, cuenta:BRAND.pago.honorarios.cuenta, email:BRAND.pago.honorarios.email }

// El anfitrión de diálogos (DialogHost, en App.jsx) se registra aquí al montarse.
export const setDialogHost = fn => { _dialogHost = fn }

// Pantalla que se descarga la primera vez que se abre (no en el arranque de la app). Mientras llega no se ve nada: las pantallas
// ya tienen su propia carga, y un recuadro intermedio solo agregaría un parpadeo.
export const lazyVista = (cargar, nombre) => {
  const L = lazy(() => cargar().then(m => ({ default: m[nombre] })))
  return props => <Suspense fallback={null}><L {...props} /></Suspense>
}
