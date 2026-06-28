// caf.ts — Código de Asignación de Folios (CAF) del SII: parseo y firma del timbre (TED).
//
// El CAF es el XML <AUTORIZACION> que el estudio descarga del SII por cada tipo de DTE.
// Contiene:
//   - el bloque <CAF>...</CAF> (rango de folios + llave pública + firma del SII) que se
//     embebe TAL CUAL dentro del timbre <TED><DD><CAF>… del documento, y
//   - <RSASK> = la llave privada con la que se firma el <DD> del timbre (algoritmo SHA1withRSA).
//
// La llave del CAF NO viaja al front: el CAF completo vive en la tabla dte_folios (solo
// service_role) y se usa únicamente acá, en la Edge Function. Misma librería (forge) que auth.ts.

// deno-lint-ignore-file no-explicit-any
import forge from 'forge'

export interface CafParsed {
  tipoDte: number     // TD: 33, 34, 61, …
  rutEmisor: string   // RE: rut autorizado en el CAF
  desde: number       // RNG > D: primer folio
  hasta: number       // RNG > H: último folio
  cafXml: string      // bloque <CAF>…</CAF> verbatim (se embebe en el TED, byte a byte como lo emitió el SII)
  rsask: any          // llave privada (RSASK) para firmar el DD del timbre
}

const el = (tag: string, src: string): string | null => {
  const m = src.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`))
  return m ? m[1].trim() : null
}

// Parsea un <AUTORIZACION> (CAF) descargado del SII. Lanza si falta algo crítico.
export function parseCaf(autorizacionXml: string): CafParsed {
  const cafBlock = autorizacionXml.match(/<CAF[\s\S]*?<\/CAF>/)?.[0]
  if (!cafBlock) throw new Error('CAF inválido: no se encontró el bloque <CAF>')

  const td = parseInt(el('TD', cafBlock) || '0', 10)
  const re = el('RE', cafBlock) || ''
  const rng = cafBlock.match(/<RNG>[\s\S]*?<\/RNG>/)?.[0] || ''
  const desde = parseInt(el('D', rng) || '0', 10)
  const hasta = parseInt(el('H', rng) || '0', 10)

  const rsaskPem = el('RSASK', autorizacionXml)
  if (!rsaskPem) throw new Error('CAF inválido: falta <RSASK> (llave privada del timbre)')
  if (!td || !desde || !hasta) throw new Error(`CAF inválido: TD/RNG incompletos (TD=${td}, D=${desde}, H=${hasta})`)

  let rsask: any
  try {
    rsask = forge.pki.privateKeyFromPem(rsaskPem)
  } catch (e) {
    throw new Error('CAF inválido: no se pudo leer la llave RSASK: ' + (e instanceof Error ? e.message : e))
  }

  return { tipoDte: td, rutEmisor: re, desde, hasta, cafXml: cafBlock, rsask }
}

// Firma el <DD> del timbre con la llave privada del CAF (RSA-SHA1) → contenido de <FRMT>.
// El DD debe pasarse YA en su forma canónica (string exacto que va dentro del TED).
export function firmarTED(ddXml: string, rsask: any): string {
  const md = forge.md.sha1.create()
  md.update(ddXml, 'utf8')
  return forge.util.encode64(rsask.sign(md))
}
