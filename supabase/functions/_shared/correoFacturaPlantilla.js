// Plantilla aprendida del correo de una factura: se guarda con marcas ({folios}, {total}, {periodo}, {cuota}, {folio}) en vez de
// los valores de ESA factura, para que la próxima cuota del mismo proyecto no repita el número de la anterior.
// Pura (sin red ni base): la usa el envío de facturas (BillingView) y se prueba en tests/correo-factura-plantilla.test.mjs.

// «cuota 1 de 18», «pago 2 de 10», «la cuota de 1 de 2»: el N° y el total son variables.
const RX_CUOTA = /\b(cuota|pago)(\s+(?:de\s+)?)(\d+)\s+de\s+(\d+)\b/gi

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
 * @param {any} texto @param {{folios?:string, total?:string, periodo?:string, folio?:string}} v
 */
export function tokenizar(texto, v = {}) {
  let s = String(texto == null ? '' : texto)
  if (v.folios) s = s.split(v.folios).join('{folios}')
  if (v.total) s = s.split(v.total).join('{total}')
  if (v.periodo && String(v.periodo).length >= 4) s = s.split(v.periodo).join('{periodo}')
  if (v.folio && String(v.folio).length >= 3 && !s.includes('{folios}')) s = s.replace(new RegExp(`(?<![\\d.,])${String(v.folio).replace(/[^\w]/g, '')}(?![\\d])`, 'g'), '{folio}')
  return s.replace(RX_CUOTA, (_m, pal, sep) => `${pal}${sep}{cuota}`)
}

/**
 * Devuelve las marcas a su valor. Si queda una marca sin valor (p. ej. {cuota} en una factura que no es cuota), `completo` es false
 * y quien llama usa el texto por defecto: mejor un texto genérico que una cuota equivocada.
 * @param {any} texto @param {{folios?:string, total?:string, periodo?:string, cuota?:{n:number,tot:number}|null, folio?:string}} v
 * @returns {{texto:string, completo:boolean}}
 */
export function destokenizar(texto, v = {}) {
  let s = String(texto == null ? '' : texto)
  if (v.folios != null) s = s.split('{folios}').join(v.folios)
  if (v.total != null) s = s.split('{total}').join(v.total)
  if (v.periodo != null && v.periodo !== '') s = s.split('{periodo}').join(v.periodo)
  if (v.folio != null && v.folio !== '') s = s.split('{folio}').join(v.folio)
  if (v.cuota) s = s.split('{cuota}').join(`${v.cuota.n} de ${v.cuota.tot}`)
  return { texto: s, completo: !/\{(?:folios|total|periodo|cuota|folio)\}/.test(s) }
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
