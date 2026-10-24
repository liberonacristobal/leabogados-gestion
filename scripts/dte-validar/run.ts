import { armarDocumento } from './dte.ts'
import { writeFileSync } from 'node:fs'
const cafX = (td: number) => `<CAF version="1.0"><DA><RE>77700387-9</RE><RS>LIBERONA ESCALA ABOGADOS LIMITADA</RS><TD>${td}</TD><RNG><D>1</D><H>100</H></RNG><FA>2026-10-24</FA><RSAPK><M>TU9EVUxPLURFLVBSVUVCQS1OTy1FUy1VTkEtTExBVkU=</M><E>Aw==</E></RSAPK><IDK>100</IDK></DA><FRMA algoritmo="SHA1withRSA">RklSTUEtREUtUFJVRUJB</FRMA></CAF>`
const caf = (td: number) => ({ tipoDte: td, rutEmisor: '77700387-9', desde: 1, hasta: 100, cafXml: cafX(td), rsask: null })
const emisor = { rut: '77.700.387-9', rs: 'Liberona Escala Abogados Limitada', giro: 'Servicios jurídicos', acteco: '691001', dir: 'Dirección de prueba 100', comuna: 'Santiago' }
const receptor = { rut: '76.123.456-7', rs: 'Cliente de Prueba SpA', giro: 'Asesorías', dir: 'Calle 123', comuna: 'Las Condes' }
const sig = `<Signature xmlns="http://www.w3.org/2000/09/xmldsig#"><SignedInfo><CanonicalizationMethod Algorithm="http://www.w3.org/TR/2001/REC-xml-c14n-20010315"/><SignatureMethod Algorithm="http://www.w3.org/2000/09/xmldsig#rsa-sha1"/><Reference URI="#X"><Transforms><Transform Algorithm="http://www.w3.org/2000/09/xmldsig#enveloped-signature"/></Transforms><DigestMethod Algorithm="http://www.w3.org/2000/09/xmldsig#sha1"/><DigestValue>QUJD</DigestValue></Reference></SignedInfo><SignatureValue>QUJD</SignatureValue><KeyInfo><KeyValue><RSAKeyValue><Modulus>QUJD</Modulus><Exponent>AQAB</Exponent></RSAKeyValue></KeyValue><X509Data><X509Certificate>QUJD</X509Certificate></X509Data></KeyInfo></Signature>`
const casos: any[] = [
  { tipoDte: 34, folio: 5, fecha: '2026-10-24', emisor, receptor, items: [{ nombre: 'Honorarios profesionales', desc: 'Cuota 2/3 · Reorganización societaria & otros', monto: 1200000 }] },
  { tipoDte: 61, folio: 6, fecha: '2026-10-24', emisor, receptor, exenta: true, items: [{ nombre: 'Anula factura N° 5', monto: 1200000 }], referencias: [{ tpoDocRef: 34, folioRef: 5, fchRef: '2026-10-24', codRef: 1, razonRef: 'Anula documento' }] },
]
for (const c of casos) {
  const { documento } = armarDocumento(c, caf(c.tipoDte), '2026-10-24T16:00:00')
  writeFileSync(`dte_${c.tipoDte}.xml`, `<?xml version="1.0" encoding="UTF-8"?><DTE xmlns="http://www.sii.cl/SiiDte" version="1.0">${documento}${sig}</DTE>`)
}
console.log('ok')
