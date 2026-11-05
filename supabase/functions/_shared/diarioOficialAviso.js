// Aviso por correo de las publicaciones del Diario Oficial (Empresas y Cooperativas) que son de sociedades de clientes.
// Reglas puras: las usa la función diario-oficial (lectura de las 08:30) y se prueban en tests/diario-oficial-aviso.test.mjs.
// Una publicación es de un cliente por RUT (seguro) o, si no calza el RUT, por el mismo nombre que una ficha o razón social (con aviso
// para verificar). Cada correo va al socio dueño del cliente; si no se sabe quién es, a los dos socios.

/** RUT sin puntos ni guion, con dígito verificador en mayúscula; '' si no parece un RUT. @param {any} r */
export const rutClave = (r) => { const k = String(r || '').replace(/[^0-9kK]/g, '').toUpperCase(); return k.length >= 7 ? k : '' }

/** Mismo criterio de la tabla (nombre_norm): minúsculas, sin acentos ni puntuación, espacios colapsados. @param {any} s */
export const nombreClave = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9& ]/g, ' ').replace(/\s+/g, ' ').trim()

/** «77704691-8» o «777046918» → «77.704.691-8». @param {any} r */
export const rutBonito = (r) => { const k = rutClave(r); if (!k) return ''; const cuerpo = k.slice(0, -1).replace(/\B(?=(\d{3})+(?!\d))/g, '.'); return `${cuerpo}-${k.slice(-1)}` }

/** «RAZÓN SOCIAL 77.898.170-K*» → «RAZÓN SOCIAL». @param {any} n */
export const quitarRut = (n) => String(n || '').replace(/\s+\d{1,3}(\.\d{3}){2}-[\dkK]\*?$/, '').replace(/\*+$/, '').replace(/\s+/g, ' ').trim()

/**
 * @param {{fecha?:string, nombre?:string, nombre_norm?:string, rut?:string|null, categoria?:string, subtipo?:string, cve?:string, url?:string}[]} pubs
 * @param {{id:any, name?:string, rut?:string|null, abogado_responsable?:string|null, status?:string|null}[]} clientes
 * @param {{client_id:any, name?:string|null, rut?:string|null}[]} entidades
 * @returns {{pub:any, clientId:string, cliente:string, abogado:string, via:'rut'|'nombre', nota:string}[]}
 */
export function calzarPublicaciones(pubs, clientes, entidades) {
  const vivos = (clientes || []).filter((c) => c && c.status !== 'Prospecto')
  const porId = new Map(vivos.map((c) => [String(c.id), c]))
  /** @type {Map<string, {clientId:string, rut:string}[]>} */ const porRut = new Map()
  /** @type {Map<string, {clientId:string, rut:string}[]>} */ const porNombre = new Map()
  const poner = (m, k, clientId, rut) => { if (!k) return; const l = m.get(k) || []; if (!l.some((x) => x.clientId === clientId)) l.push({ clientId, rut }); m.set(k, l) }
  for (const c of vivos) { poner(porRut, rutClave(c.rut), String(c.id), rutClave(c.rut)); if (nombreClave(c.name).length >= 7) poner(porNombre, nombreClave(c.name), String(c.id), rutClave(c.rut)) }
  for (const e of entidades || []) { const id = String(e.client_id); if (!porId.has(id)) continue; poner(porRut, rutClave(e.rut), id, rutClave(e.rut)); if (nombreClave(e.name).length >= 7) poner(porNombre, nombreClave(e.name), id, rutClave(e.rut)) }
  const out = []
  for (const p of pubs || []) {
    const rp = rutClave(p.rut)
    const porR = rp ? porRut.get(rp) : null
    if (porR && porR.length) { for (const x of porR) out.push({ pub: p, clientId: x.clientId, cliente: porId.get(x.clientId)?.name || '', abogado: String(porId.get(x.clientId)?.abogado_responsable || ''), via: /** @type {const} */ ('rut'), nota: '' }); continue }
    const nom = nombreClave(p.nombre_norm || quitarRut(p.nombre))
    const porN = nom.length >= 7 ? porNombre.get(nom) : null
    if (!porN || !porN.length) continue
    for (const x of porN) {
      const rf = x.rut
      const nota = !rp ? 'Calza por el nombre. La publicación no trae RUT.' : !rf ? 'Calza por el nombre. La ficha no tiene RUT.' : `Calza por el nombre. En la ficha la sociedad tiene el RUT ${rutBonito(rf)}.`
      out.push({ pub: p, clientId: x.clientId, cliente: porId.get(x.clientId)?.name || '', abogado: String(porId.get(x.clientId)?.abogado_responsable || ''), via: /** @type {const} */ ('nombre'), nota })
    }
  }
  return out
}

/**
 * Correos que reciben el aviso de un cliente: su abogado si es socio; si no se sabe quién es (sin abogado o que no es socio), los socios.
 * @param {string} abogado @param {{socios:{email:string}[], correoDe:(n:string)=>string}} eq
 */
export function destinatariosAviso(abogado, eq) {
  const socios = (eq?.socios || []).map((s) => String(s.email).toLowerCase())
  const e = abogado ? String(eq.correoDe(abogado) || '').toLowerCase() : ''
  return e && socios.includes(e) ? [e] : socios
}

/** correo → coincidencias que le tocan (una publicación de un cliente va a quien corresponde). */
export function porDestinatario(coincidencias, eq) {
  /** @type {Map<string, any[]>} */ const m = new Map()
  for (const c of coincidencias || []) for (const e of destinatariosAviso(c.abogado, eq)) { const l = m.get(e) || []; l.push(c); m.set(e, l) }
  return m
}

/** @param {number} n */
export const asuntoAviso = (n) => `Diario Oficial: ${n} ${n === 1 ? 'publicación' : 'publicaciones'} de clientes`

/** Frase de apertura: la edición si todas son del mismo día; si no, «Publicaciones recientes». @param {string[]} fechas */
export function introAviso(fechas) {
  const f = [...new Set((fechas || []).filter(Boolean))]
  const dmy = (iso) => String(iso).slice(0, 10).split('-').reverse().join('-')
  return f.length === 1 ? `Edición del ${dmy(f[0])}. Publicaciones de sociedades de clientes:` : 'Publicaciones recientes de sociedades de clientes:'
}
