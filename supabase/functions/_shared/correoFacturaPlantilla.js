// Plantilla aprendida del correo de una factura: se guarda con marcas ({folios}, {total}, {periodo}, {cuota}, {folio}, {mes}, {trabajos}) en vez de
// los valores de ESA factura, para que la próxima cuota del mismo proyecto no repita el número de la anterior.
// Pura (sin red ni base): la usa el envío de facturas (BillingView) y se prueba en tests/correo-factura-plantilla.test.mjs.

// «cuota 1 de 18», «pago 2 de 10», «la cuota de 1 de 2»: el N° y el total son variables.
const RX_CUOTA = /\b(cuota|pago)(\s+(?:de\s+)?)(\d+)\s+de\s+(\d+)\b/gi

// «octubre de 2026» / «Octubre de 2026»: el mes y el año cambian cada mes, así que se guardan como marca ({mes} en minúscula, {Mes} capitalizado).
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']
const RX_MES = new RegExp(`\\b(${MESES.join('|')})\\s+de\\s+(20\\d{2})\\b`, 'gi')

/** «Octubre 2026» / «octubre de 2026» → {mes:'octubre', anio:'2026'}; otro texto → null. @param {any} t @returns {{mes:string, anio:string}|null} */
export function partesMes(t) {
  const m = String(t || '').trim().match(new RegExp(`^(${MESES.join('|')})\\s+(?:de\\s+)?(20\\d{2})$`, 'i'))
  return m ? { mes: m[1].toLowerCase(), anio: m[2] } : null
}

// Despedidas que agrega el propio envío (CORREO_DESPEDIDA y «Saludos,»): no deben quedar guardadas dentro del cuerpo.
const RX_DESPEDIDA = /^\s*(?:les?\s+saluda(?:mos)?\s+(?:atentamente|cordialmente)|saludos(?:\s+cordiales)?|atentamente|cordialmente|quedamos\s+atentos[^\n]*|quedo\s+atento[^\n]*)\s*[,.]?\s*$/i

/** Quita del final las líneas de despedida (y las vacías). @param {any} texto @returns {string} */
export function quitarDespedida(texto) {
  const l = String(texto == null ? '' : texto).replace(/\r/g, '').split('\n')
  while (l.length && (!l[l.length - 1].trim() || RX_DESPEDIDA.test(l[l.length - 1]))) l.pop()
  return l.join('\n').replace(/\s+$/, '')
}

/** Espacios dobles dentro de una línea («oct  26» viene así de la glosa del SII); no toca los saltos de línea. @param {any} t @returns {string} */
export function limpiarEspacios(t) { return String(t == null ? '' : t).replace(/[ \t]{2,}/g, ' ') }

/** «Cuota 3/10», «Pago 3 de 10», «3 de 10» → {n:3, tot:10}; sin cuota → null. @param {any} t */
export function cuotaDe(t) {
  const m = String(t || '').match(/(?:cuota|pago)?\s*(\d+)\s*(?:\/|de)\s*(\d+)/i)
  return m ? { n: +m[1], tot: +m[2] } : null
}

/**
 * Cambia los valores de la factura por marcas.
 * @param {any} texto @param {{folios?:string, total?:string, periodo?:string, folio?:string, trabajos?:string}} v
 */
export function tokenizar(texto, v = {}) {
  let s = String(texto == null ? '' : texto)
  // Correo de varias facturas: las líneas «– Trabajo: … (N° folio).» salen de las facturas de cada envío. Se guardan como {trabajos}, esté o no a mano el valor:
  // un bloque de líneas con «N° ###» en un texto ya guardado (p. ej. de antes de esta marca) también se convierte, para no repetir folios de otro envío.
  if (v.trabajos) s = s.split(v.trabajos).join('{trabajos}')
  s = s.replace(/(^|\n)((?:–[^\n]*(?:\n|$))+)/g, (m, ini, bloque) => /(?:N°|No\.)\s*\d{3,}/.test(bloque) ? `${ini}{trabajos}${/\n$/.test(bloque) ? '\n' : ''}` : m)
  if (v.folios) s = s.split(v.folios).join('{folios}')
  if (v.total) s = s.split(v.total).join('{total}')
  if (v.periodo && String(v.periodo).length >= 4) s = s.split(v.periodo).join('{periodo}')
  if (v.folio && String(v.folio).length >= 3 && !s.includes('{folios}')) s = s.replace(new RegExp(`(?<![\\d.,])${String(v.folio).replace(/[^\w]/g, '')}(?![\\d])`, 'g'), '{folio}')
  s = s.replace(RX_MES, m => (/^[A-ZÁÉÍÓÚ]/.test(m) ? '{Mes}' : '{mes}'))
  return s.replace(RX_CUOTA, (_m, pal, sep) => `${pal}${sep}{cuota}`)
}

/**
 * Devuelve las marcas a su valor. Si queda una marca sin valor (p. ej. {cuota} en una factura que no es cuota), `completo` es false
 * y quien llama usa el texto por defecto: mejor un texto genérico que una cuota equivocada.
 * @param {any} texto @param {{folios?:string, total?:string, periodo?:string, cuota?:{n:number,tot:number}|null, folio?:string, mes?:{mes:string,anio:string}|null, trabajos?:string}} v
 * @returns {{texto:string, completo:boolean}}
 */
export function destokenizar(texto, v = {}) {
  let s = String(texto == null ? '' : texto)
  if (v.folios != null) s = s.split('{folios}').join(v.folios)
  if (v.total != null) s = s.split('{total}').join(v.total)
  if (v.periodo != null && v.periodo !== '') s = s.split('{periodo}').join(v.periodo)
  if (v.folio != null && v.folio !== '') s = s.split('{folio}').join(v.folio)
  if (v.trabajos != null && v.trabajos !== '') s = s.split('{trabajos}').join(v.trabajos)
  if (v.cuota) s = s.split('{cuota}').join(`${v.cuota.n} de ${v.cuota.tot}`)
  if (v.mes) s = s.split('{mes}').join(`${v.mes.mes} de ${v.mes.anio}`).split('{Mes}').join(`${v.mes.mes.charAt(0).toUpperCase()}${v.mes.mes.slice(1)} de ${v.mes.anio}`)
  return { texto: s, completo: !/\{(?:folios|total|periodo|cuota|folio|mes|Mes|trabajos)\}/.test(s) }
}

/**
 * ¿El texto nombra una cuota distinta de la de la factura? («cuota 1 de 18» en la cuota 2/18). Sin cuota conocida no opina.
 * @param {any} texto @param {{n:number,tot:number}|null|undefined} cuota
 * @returns {{dice:string, es:string}|null}
 */
export function cuotaIncoherente(texto, cuota) {
  if (!cuota) return null
  for (const m of String(texto || '').matchAll(RX_CUOTA)) {
    if (+m[3] !== cuota.n || +m[4] !== cuota.tot) return { dice: `${m[3]} de ${m[4]}`, es: `${cuota.n} de ${cuota.tot}` }
  }
  return null
}

/**
 * Números escritos a mano en una plantilla aprendida que NO se refrescan solos: un monto («$1.190.000») o un folio («factura N° 500»).
 * El mes («octubre de 2026») y la cuota («cuota 2 de 10») no cuentan: `tokenizar` sin valores los convierte en marca al leer la plantilla.
 * @param {any} texto @returns {string[]}
 */
export function numerosEscritos(texto) {
  const t = String(texto == null ? '' : texto).replace(/\{[a-zA-Z]+\}/g, ' ')
  const montos = t.match(/\$\s?\d[\d.]*/g) || []
  const folios = [...t.matchAll(/\b(?:facturas?|folios?|n[°º])\s*(?:n[°º]\s*)?(\d{3,}(?:\s*(?:,|y)\s*\d{3,})*)/gi)].map(m => m[0].trim())
  return [...montos.map(x => x.trim().replace(/\.+$/, '')), ...folios]
}
