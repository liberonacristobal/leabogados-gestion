// equipo.js — el equipo del estudio desde la tabla miembros: fuente única de nombres, iniciales y correos para los correos y
// avisos internos de las funciones del servidor (antes copiados en cada función).
// Solo las filas principales (un correo por persona; los alias quedan fuera) del estudio de esta instalación (secreto ESTUDIO_ID).
// EQUIPO_RESPALDO cubre solo si la consulta falla o viene vacía, para no dejar un aviso sin destinatario.
// El orden es por correo, estable: «el primer socio» (destinatario por defecto) y el orden de envío no cambian entre corridas.
const env = (k) => { try { return globalThis.Deno?.env?.get(k) || '' } catch (_) { return '' } }
export const ESTUDIO_ID = env('ESTUDIO_ID') || 'lea'

export const EQUIPO_RESPALDO = [
  { email: 'cl@leabogados.cl', nombre: 'Cristóbal', iniciales: 'CL', rol: 'admin', es_socio: true },
  { email: 'ee@leabogados.cl', nombre: 'Erasmo', iniciales: 'EE', rol: 'admin', es_socio: true },
  { email: 'mc@leabogados.cl', nombre: 'Martín', iniciales: 'MC', rol: 'limited', es_socio: false },
  { email: 'mp@leabogados.cl', nombre: 'Martina', iniciales: 'MP', rol: 'limited', es_socio: false },
  { email: 'rd@leabogados.cl', nombre: 'Rodrigo', iniciales: 'RD', rol: 'limited', es_socio: false },
]

export const sinTildes = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
const norm = (s) => sinTildes(s).toLowerCase().replace(/\s+/g, ' ').trim()

export function armarEquipo(filas) {
  const miembros = (filas || []).filter((m) => m && String(m.email || '').includes('@') && String(m.nombre || '').trim())
    .map((m) => ({
      email: String(m.email).toLowerCase().trim(), nombre: String(m.nombre).trim(),
      ini: String(m.iniciales || '').toUpperCase().trim() || sinTildes(m.nombre).slice(0, 2).toUpperCase(),
      rol: String(m.rol || ''), socio: !!m.es_socio,
    }))
    .sort((a, b) => a.email.localeCompare(b.email))
  const porNombre = {}, nombreDe = {}, porIni = {}, iniDe = {}, nombrePorIni = {}, porNorm = {}
  for (const m of miembros) {
    porNombre[m.nombre] = m.email
    nombreDe[m.email] = m.nombre
    porIni[m.ini] = m.email; iniDe[m.email] = m.ini; nombrePorIni[m.ini] = m.nombre
    if (!porNorm[norm(m.nombre)]) porNorm[norm(m.nombre)] = m.email
  }
  // porNombre es estricto (una clave por persona: se puede recorrer para enviar). Para buscar un nombre que viene sin tildes o
  // con otra mayúscula («Martin», «Cristobal» en tareas antiguas) usar correoDe.
  return {
    miembros, porNombre, nombreDe, porIni, iniDe, nombrePorIni,
    admins: miembros.filter((m) => m.rol === 'admin').map((m) => m.email),
    socios: miembros.filter((m) => m.socio),
    limitados: miembros.filter((m) => m.rol === 'limited'),
    // Correo por nombre tolerante a tildes, mayúsculas y espacios.
    correoDe: (nombre) => porNombre[nombre] || porNorm[norm(nombre)] || '',
  }
}

export async function cargarEquipo(sbUrl, serviceKey) {
  try {
    const r = await fetch(`${sbUrl}/rest/v1/miembros?select=email,nombre,iniciales,rol,es_socio&principal=is.true&estudio_id=eq.${encodeURIComponent(ESTUDIO_ID)}&order=email.asc`,
      { headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` } })
    if (r.ok) { const d = await r.json(); if (Array.isArray(d) && d.length) return armarEquipo(d) }
  } catch (_) { /* respaldo */ }
  return armarEquipo(EQUIPO_RESPALDO)
}
