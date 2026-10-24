// Arma con el código real del motor (dte.ts, firma.ts, emision.ts, libro.ts) un sobre EnvioDTE y un libro FIRMADOS con la llave
// de prueba, con texto acentuado, y los guarda en ISO-8859-1 como irían al SII. firma_verify.py los verifica.
import { armarDocumento } from './dte.ts'
import { firmarDocumento } from './firma.ts'
import { armarEnvioDTE, latin1 } from './emision.ts'
import { armarLibroVentas } from './libro.ts'
import { writeFileSync } from 'node:fs'
const cafX = (td: number) => `<CAF version="1.0"><DA><RE>77700387-9</RE><RS>LIBERONA ESCALA ABOGADOS LIMITADA</RS><TD>${td}</TD><RNG><D>1</D><H>100</H></RNG><FA>2026-10-24</FA><RSAPK><M>TU9EVUxPLURFLVBSVUVCQS1OTy1FUy1VTkEtTExBVkU=</M><E>Aw==</E></RSAPK><IDK>100</IDK></DA><FRMA algoritmo="SHA1withRSA">RklSTUEtREUtUFJVRUJB</FRMA></CAF>`
const caf = (td: number) => ({ tipoDte: td, rutEmisor: '77700387-9', desde: 1, hasta: 100, cafXml: cafX(td), rsask: null })
const emisor = { rut: '77700387-9', rs: 'Liberona Escala Abogados Limitada', giro: 'Servicios jurídicos y asesorías', acteco: '691001', dir: 'Av. Pdte. Kennedy 7900, of. 905', comuna: 'Vitacura' }
const receptor = { rut: '76123456-0', rs: 'Compañía de Prueba Ñuñoa SpA', giro: 'Asesorías', dir: 'Calle Peñalolén 123', comuna: 'Peñalolén' }
const now = '2026-10-24T16:00:00'
const dtes = [34, 61].map((td, i) => {
  const c: any = { tipoDte: td, folio: 5 + i, fecha: '2026-10-24', emisor, receptor, items: [{ nombre: td === 34 ? 'Honorarios profesionales — “cuota” 2/3' : 'Anula factura N° 5', desc: 'Reorganización societaria', monto: 1200000 }], ...(td === 61 ? { exenta: true, referencias: [{ tpoDocRef: 34, folioRef: 5, fchRef: '2026-10-24', codRef: 1, razonRef: 'Anula factura' }] } : {}) }
  const { documento, docId } = armarDocumento(c, caf(td), now)
  return `<DTE version="1.0">${documento}${firmarDocumento(documento, docId)}</DTE>`
})
const envio = armarEnvioDTE(dtes, { rutEmisor: '77700387-9', rutEnvia: '11111111-1', fchResol: '2014-08-22', nroResol: 0, subtotales: [{ tipoDte: 34, nro: 1 }, { tipoDte: 61, nro: 1 }] }, now)
writeFileSync('envio_firmado.xml', latin1(envio))
const libro = armarLibroVentas({ rutEmisor: '77700387-9', rutEnvia: '11111111-1', periodo: '2026-10', fchResol: '2014-08-22', nroResol: 0 }, [{ tpoDoc: 34, nroDoc: 5, fchDoc: '2026-10-24', rutDoc: '76123456-0', rznSoc: 'Compañía de Prueba Ñuñoa SpA', mntExe: 1200000, mntTotal: 1200000 }], now)
writeFileSync('libro_firmado.xml', latin1(libro))
console.log('ok')
// Intercambio: un envío RECIBIDO por el estudio (receptor 77700387-9) y las tres respuestas firmadas.
import { leerEnvioRecibido, armarRecepcionEnvio, armarResultadoDTE, armarEnvioRecibos } from './intercambio.ts'
const ajeno = { rut: '76123456-0', rs: 'Proveedor de Prueba Ñandú SpA', giro: 'Servicios', acteco: '620200', dir: 'Calle 1', comuna: 'Santiago' }
const lea = { rut: '77700387-9', rs: 'Liberona Escala Abogados Limitada', giro: 'Servicios jurídicos', dir: 'Av. Pdte. Kennedy 7900, of. 905', comuna: 'Vitacura' }
const { documento: dR, docId: idR } = armarDocumento({ tipoDte: 34, folio: 77, fecha: '2026-10-20', emisor: ajeno, receptor: lea, items: [{ nombre: 'Servicio de prueba', monto: 500000 }] } as any, { ...caf(34), rutEmisor: '76123456-0' }, now)
const recibido = armarEnvioDTE([`<DTE version="1.0">${dR}${firmarDocumento(dR, idR)}</DTE>`], { rutEmisor: '76123456-0', rutEnvia: '11111111-1', fchResol: '2014-08-22', nroResol: 0, subtotales: [{ tipoDte: 34, nro: 1 }] }, now)
const env = leerEnvioRecibido(recibido)
const cont = { nombre: 'Contacto de prueba', mail: 'contacto@ejemplo.cl' }
writeFileSync('resp_recepcion.xml', latin1(armarRecepcionEnvio(env, { rutResponde: '77700387-9', nmbEnvio: 'envio_recibido.xml', contacto: cont, ts: now })))
writeFileSync('resp_resultado.xml', latin1(armarResultadoDTE(env, { rutResponde: '77700387-9', contacto: cont, ts: now })))
writeFileSync('resp_recibos.xml', latin1(armarEnvioRecibos(env, { rutResponde: '77700387-9', rutFirma: '11111111-1', recinto: 'Oficina central', contacto: cont, ts: now })))
