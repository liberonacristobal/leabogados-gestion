// auth.ts — danza de autenticacion del SII: getSeed -> firmar semilla -> getToken.
//
// DECISION DE FIRMA (validada): todo en Deno, sin microservicio externo.
// - node-forge (JS puro, sin nativos de Node) abre el .pfx (PKCS#12) y firma RSA-SHA1.
// - El XMLDSIG se construye manualmente con C14N "por construccion": el XML de
//   getToken es diminuto, fijo y lo generamos nosotros. Emitirlo ya en forma
//   canonica (UTF-8, cero whitespace entre elementos, atributos con comillas
//   dobles, tags vacios como par <X></X>, sin namespaces superfluos) hace el
//   digest determinista. Es el mismo enfoque de LibreDTE y otras integraciones
//   chilenas probadas: nadie canoniza la semilla con un motor C14N generico.
// - PLAN B (si certificacion rechazara la firma): migrar SOLO este modulo a un
//   microservicio Node (xml-crypto) — rcv.ts, match.ts e index.ts no cambian.
//
// El token dura ~1 hora; se cachea en memoria con TTL 55 min para no repetir
// la danza en cada consulta (las instancias warm de la Edge Function lo retienen).

// deno-lint-ignore-file no-explicit-any
import forge from 'forge'
import { getConfig } from './config.ts'
import { fetchSII, conReintentos, xmlEscape, xmlUnescape } from './http.ts'

const DSIG = 'http://www.w3.org/2000/09/xmldsig#'
const TTL_MS = 55 * 60 * 1000

let tokenCache: { token: string; expira: number } | null = null

interface Credenciales {
  key: any
  certPemB64: string
  modulusB64: string
  exponentB64: string
}
let credCache: Credenciales | null = null

// Abre el .pfx (base64 en secreto) y extrae clave privada + certificado.
function cargarCertificado(): Credenciales {
  if (credCache) return credCache
  const { certB64, certPassword } = getConfig()
  if (!certB64) throw new Error('Falta el secreto SII_CERT_B64')
  const der = forge.util.decode64(certB64)
  const asn1 = forge.asn1.fromDer(der)
  const p12 = forge.pkcs12.pkcs12FromAsn1(asn1, certPassword)

  const shrouded = p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag })[forge.pki.oids.pkcs8ShroudedKeyBag] || []
  const plain = p12.getBags({ bagType: forge.pki.oids.keyBag })[forge.pki.oids.keyBag] || []
  const keyBag = shrouded[0] || plain[0]
  const certBag = (p12.getBags({ bagType: forge.pki.oids.certBag })[forge.pki.oids.certBag] || [])[0]
  if (!keyBag?.key || !certBag?.cert) {
    throw new Error('No se pudo extraer clave/certificado del .pfx (revisa SII_CERT_B64 y SII_CERT_PASSWORD)')
  }

  const certPem = forge.pki.certificateToPem(certBag.cert)
  const certPemB64 = certPem.replace(/-----(BEGIN|END) CERTIFICATE-----/g, '').replace(/\s+/g, '')

  // Modulus/Exponent en base64 big-endian, sin bytes de signo sobrantes
  const bigIntB64 = (n: any) => {
    let hex = n.toString(16)
    if (hex.length % 2) hex = '0' + hex
    if (parseInt(hex.slice(0, 2), 16) >= 0x80) hex = '00' + hex
    return forge.util.encode64(forge.util.hexToBytes(hex))
  }

  credCache = {
    key: keyBag.key,
    certPemB64,
    modulusB64: bigIntB64(keyBag.key.n),
    exponentB64: bigIntB64(keyBag.key.e),
  }
  console.log('[sii-sync] certificado .pfx cargado')
  return credCache
}

// Paso 1: pedir la semilla (un solo uso).
async function getSeed(): Promise<string> {
  const { seedUrl, timeoutMs } = getConfig()
  const envelope =
    '<?xml version="1.0" encoding="UTF-8"?>' +
    '<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:def="http://DefaultNamespace">' +
    '<soapenv:Header/><soapenv:Body>' +
    '<def:getSeed soapenv:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/"/>' +
    '</soapenv:Body></soapenv:Envelope>'
  const res = await fetchSII(seedUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'text/xml; charset=UTF-8', SOAPAction: '""' },
    body: envelope,
  }, timeoutMs)
  const text = await res.text()
  if (!res.ok) throw new Error(`getSeed HTTP ${res.status}`)
  const inner = xmlUnescape(text)
  const m = inner.match(/<SEMILLA>(\d+)<\/SEMILLA>/)
  if (!m) throw new Error(`getSeed: respuesta sin semilla: ${text.slice(0, 250)}`)
  console.log('[sii-sync] semilla obtenida')
  return m[1]
}

// Paso 2: firmar la semilla. XMLDSIG enveloped, RSA-SHA1, C14N por construccion.
function signSeed(seed: string): string {
  const cred = cargarCertificado()

  // Documento que se digiere: el doc completo SIN la firma (transform enveloped).
  // Esta cadena ES su propia forma canonica: sin declaracion XML, sin whitespace.
  const doc = `<getToken><item><Semilla>${seed}</Semilla></item></getToken>`
  const sha1Doc = forge.md.sha1.create()
  sha1Doc.update(doc, 'utf8')
  const digestValue = forge.util.encode64(sha1Doc.digest().getBytes())

  // SignedInfo en forma canonica: con xmlns explicito (al canonizarlo como apice,
  // el validador del SII le agrega el namespace heredado — debe coincidir byte a byte),
  // y elementos vacios como par apertura/cierre (regla de C14N).
  const signedInfo =
    `<SignedInfo xmlns="${DSIG}">` +
    '<CanonicalizationMethod Algorithm="http://www.w3.org/TR/2001/REC-xml-c14n-20010315"></CanonicalizationMethod>' +
    `<SignatureMethod Algorithm="${DSIG}rsa-sha1"></SignatureMethod>` +
    '<Reference URI="">' +
    `<Transforms><Transform Algorithm="${DSIG}enveloped-signature"></Transform></Transforms>` +
    `<DigestMethod Algorithm="${DSIG}sha1"></DigestMethod>` +
    `<DigestValue>${digestValue}</DigestValue>` +
    '</Reference></SignedInfo>'

  const sha1SI = forge.md.sha1.create()
  sha1SI.update(signedInfo, 'utf8')
  const signatureValue = forge.util.encode64(cred.key.sign(sha1SI))

  // En el documento final, SignedInfo va sin repetir xmlns (lo hereda de Signature);
  // el validador lo reinyecta al canonizar, calzando con lo firmado.
  const signedInfoEmbed = signedInfo.replace(` xmlns="${DSIG}"`, '')

  return (
    '<?xml version="1.0" encoding="UTF-8"?>' +
    `<getToken><item><Semilla>${seed}</Semilla></item>` +
    `<Signature xmlns="${DSIG}">` +
    signedInfoEmbed +
    `<SignatureValue>${signatureValue}</SignatureValue>` +
    '<KeyInfo><KeyValue><RSAKeyValue>' +
    `<Modulus>${cred.modulusB64}</Modulus><Exponent>${cred.exponentB64}</Exponent>` +
    '</RSAKeyValue></KeyValue>' +
    `<X509Data><X509Certificate>${cred.certPemB64}</X509Certificate></X509Data>` +
    '</KeyInfo></Signature></getToken>'
  )
}

// Paso 3: canjear el XML firmado por el token de sesion.
async function getTokenFromSeed(signedXml: string): Promise<string> {
  const { tokenUrl, timeoutMs } = getConfig()
  const envelope =
    '<?xml version="1.0" encoding="UTF-8"?>' +
    '<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:def="http://DefaultNamespace">' +
    '<soapenv:Header/><soapenv:Body>' +
    '<def:getToken soapenv:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">' +
    '<pszXml xsi:type="xsd:string" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema">' +
    xmlEscape(signedXml) +
    '</pszXml></def:getToken></soapenv:Body></soapenv:Envelope>'
  const res = await fetchSII(tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'text/xml; charset=UTF-8', SOAPAction: '""' },
    body: envelope,
  }, timeoutMs)
  const text = await res.text()
  if (!res.ok) throw new Error(`getToken HTTP ${res.status}`)
  const inner = xmlUnescape(text)
  const m = inner.match(/<TOKEN>([A-Z0-9]+)<\/TOKEN>/i)
  if (!m) {
    const glosa = inner.match(/<GLOSA>([^<]*)<\/GLOSA>/i)
    throw new Error(`getToken: SII rechazo la firma${glosa ? ` (${glosa[1]})` : ''}: ${text.slice(0, 250)}`)
  }
  return m[1]
}

// Punto de entrada: devuelve token cacheado o ejecuta la danza completa.
// La semilla es de UN solo uso: cada reintento repite la danza entera
// (semilla nueva + firma nueva), nunca se reusa una semilla consumida.
export async function obtenerToken(forzar = false): Promise<string> {
  if (!forzar && tokenCache && Date.now() < tokenCache.expira) {
    console.log('[sii-sync] token desde cache')
    return tokenCache.token
  }
  const token = await conReintentos('autenticacion SII', async () => {
    const seed = await getSeed()
    const signed = signSeed(seed)
    return await getTokenFromSeed(signed)
  })
  tokenCache = { token, expira: Date.now() + TTL_MS }
  console.log('[sii-sync] token obtenido y cacheado (TTL 55 min)')
  return token
}
