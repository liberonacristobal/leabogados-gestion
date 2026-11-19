// Reglas de direcciones de correo y rebotes. Fuente única para el aviso previo al envío («esta dirección no aparece en tus correos»)
// y para marcar un envío como «No entregado» cuando llega el rebote al Gmail de quien envió.

/** @param {any} e */
const norm = e => String(e || '').trim().toLowerCase()

/** Clave sin puntos en la parte local. Solo sirve para encontrar direcciones parecidas: fuera de gmail.com el punto SÍ distingue personas. @param {string} e */
const claveSinPuntos = e => { const [l, d] = norm(e).split('@'); return d ? l.replace(/\./g, '') + '@' + d : norm(e) }

/**
 * ¿La dirección es dudosa? Lo es si nunca apareció en los correos del usuario con ese cliente Y hay una conocida del mismo dominio
 * que solo difiere en los puntos. Sin parecida conocida no avisa (una dirección nueva y legítima es normal).
 * @param {string} dir
 * @param {string[]} conocidas direcciones vistas en el Gmail del usuario con ese cliente
 * @param {string} [dominioPropio] dominio del estudio (nunca se avisa)
 * @returns {{sugerida:string}|null}
 */
export function direccionDudosa(dir, conocidas, dominioPropio = '') {
  const e = norm(dir)
  if (!e.includes('@')) return null
  const dom = norm(dominioPropio).replace(/^@/, '')
  if (dom && e.endsWith('@' + dom)) return null
  const vistas = (conocidas || []).map(norm).filter(x => x.includes('@'))
  if (vistas.includes(e)) return null
  const k = claveSinPuntos(e)
  const hit = vistas.find(c => c !== e && claveSinPuntos(c) === k)
  return hit ? { sugerida: hit } : null
}

/** Motivo breve a partir del texto del rebote. @param {string} texto */
export function motivoDeRebote(texto) {
  const t = String(texto || '').toLowerCase()
  if (/no se ha encontrado|no existe|not found|doesn'?t exist|does not exist|unknown user|address not found|recipientnotfound/.test(t)) return 'la dirección no existe'
  if (/lleno|quota|mailbox full|over quota/.test(t)) return 'el buzón está lleno'
  if (/bloque|blocked|rejected|rechaz|policy|550 5\.7/.test(t)) return 'el servidor del destinatario lo bloqueó'
  return 'el servidor del destinatario lo rechazó'
}

/**
 * Cruza los rebotes recibidos con los envíos de la app. Un rebote corresponde a un envío si nombra como fallida una dirección a la que
 * ese envío salió y llegó después del envío (hasta 3 días).
 * @param {{correos:{id:string, fecha_ms:number, fallidos:string[], motivo?:string}[], envios:{id:string, tipo:string, destinatarios:string[], enviado_ms:number}[]}} p
 * @returns {{envio_id:string, tipo:string, correo_id:string, direccion:string, motivo:string, fecha_ms:number}[]}
 */
export function rebotesDe({ correos, envios }) {
  const VENTANA = 3 * 86400000
  /** @type {{envio_id:string, tipo:string, correo_id:string, direccion:string, motivo:string, fecha_ms:number}[]} */
  const out = []
  for (const en of envios || []) {
    const dest = new Set((en.destinatarios || []).map(norm))
    for (const c of correos || []) {
      if (!(c.fecha_ms >= en.enviado_ms - 60000 && c.fecha_ms <= en.enviado_ms + VENTANA)) continue
      const falla = (c.fallidos || []).map(norm).find(f => dest.has(f))
      if (!falla) continue
      out.push({ envio_id: en.id, tipo: en.tipo, correo_id: c.id, direccion: falla, motivo: c.motivo || 'el servidor del destinatario lo rechazó', fecha_ms: c.fecha_ms })
      break
    }
  }
  return out
}
