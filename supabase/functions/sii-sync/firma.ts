// firma.ts — firma XMLDSig (enveloped, RSA-SHA1, C14N por construcción) del <Documento> y del <SetDTE>.
//
// CALCADO de signSeed() de auth.ts, que YA pasa la validación del SII en la danza del token.
// Mismo principio: el SignedInfo se firma CON xmlns explícito (el validador lo reinyecta al
// canonizar como ápice) y se EMBEBE sin él (lo hereda de <Signature>). Para el digest del
// elemento referenciado se le inyecta el xmlns heredado del contenedor (SiiDte), porque el
// validador del SII lo agrega al canonizar el sub-árbol — debe coincidir byte a byte.
//
// ⚠ Se valida recién en CERTIFICACIÓN (maullin) con CAF+cert reales. auth.ts deja una "PLAN B"
// (migrar la firma a un microservicio xml-crypto) si el SII la rechazara; aplica igual aquí.

// deno-lint-ignore-file no-explicit-any
import forge from 'forge'
import { cargarCertificado } from './auth.ts'

const DSIG = 'http://www.w3.org/2000/09/xmldsig#'
const SIIDTE = 'http://www.sii.cl/SiiDte'

// Firma enveloped genérica sobre un elemento con atributo ID.
// `elementoCanon` = el elemento EXACTAMENTE como lo canoniza el validador (xmlns heredado ya explícito).
// `refUri` = '#'+ID. Devuelve el <Signature> para insertar como HERMANO del elemento firmado.
export function firmarReferencia(elementoCanon: string, refUri: string): string {
  const cred = cargarCertificado()

  const sha1Doc = forge.md.sha1.create()
  sha1Doc.update(elementoCanon, 'utf8')
  const digestValue = forge.util.encode64(sha1Doc.digest().getBytes())

  const signedInfo =
    `<SignedInfo xmlns="${DSIG}">` +
    '<CanonicalizationMethod Algorithm="http://www.w3.org/TR/2001/REC-xml-c14n-20010315"></CanonicalizationMethod>' +
    `<SignatureMethod Algorithm="${DSIG}rsa-sha1"></SignatureMethod>` +
    `<Reference URI="${refUri}">` +
    `<Transforms><Transform Algorithm="${DSIG}enveloped-signature"></Transform></Transforms>` +
    `<DigestMethod Algorithm="${DSIG}sha1"></DigestMethod>` +
    `<DigestValue>${digestValue}</DigestValue>` +
    '</Reference></SignedInfo>'

  const sha1SI = forge.md.sha1.create()
  sha1SI.update(signedInfo, 'utf8')
  const signatureValue = forge.util.encode64(cred.key.sign(sha1SI))

  const signedInfoEmbed = signedInfo.replace(` xmlns="${DSIG}"`, '')

  return (
    `<Signature xmlns="${DSIG}">` +
    signedInfoEmbed +
    `<SignatureValue>${signatureValue}</SignatureValue>` +
    '<KeyInfo><KeyValue><RSAKeyValue>' +
    `<Modulus>${cred.modulusB64}</Modulus><Exponent>${cred.exponentB64}</Exponent>` +
    '</RSAKeyValue></KeyValue>' +
    `<X509Data><X509Certificate>${cred.certPemB64}</X509Certificate></X509Data>` +
    '</KeyInfo></Signature>'
  )
}

// Firma un <Documento> (DTE individual). En el <DTE> final el Documento NO lleva xmlns (lo hereda);
// para el digest se le inyecta el SiiDte heredado, que es como el SII lo canoniza.
export function firmarDocumento(documento: string, docId: string): string {
  const canon = documento.replace('<Documento ', `<Documento xmlns="${SIIDTE}" `)
  return firmarReferencia(canon, '#' + docId)
}

// Firma el <SetDTE> del sobre EnvioDTE. Mismo criterio del xmlns heredado.
export function firmarSetDTE(setDte: string, setId: string): string {
  const canon = setDte.replace('<SetDTE ', `<SetDTE xmlns="${SIIDTE}" `)
  return firmarReferencia(canon, '#' + setId)
}
