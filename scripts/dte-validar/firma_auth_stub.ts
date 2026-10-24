// Reemplaza auth.ts en la prueba de firmas: genera una llave y un certificado de PRUEBA (nada real) con node-forge.
import forge from 'node-forge'
import { writeFileSync } from 'node:fs'
const keys = forge.pki.rsa.generateKeyPair(1024)
const cert = forge.pki.createCertificate()
cert.publicKey = keys.publicKey; cert.serialNumber = '01'
cert.validity.notBefore = new Date(); cert.validity.notAfter = new Date(Date.now() + 864e5)
const attrs = [{ name: 'commonName', value: 'Certificado de prueba' }]
cert.setSubject(attrs); cert.setIssuer(attrs); cert.sign(keys.privateKey)
const b64 = (n: any) => { let h = n.toString(16); if (h.length % 2) h = '0' + h; if (parseInt(h.slice(0, 2), 16) >= 0x80) h = '00' + h; return forge.util.encode64(forge.util.hexToBytes(h)) }
const cred = { key: keys.privateKey, certPemB64: forge.pki.certificateToPem(cert).replace(/-----(BEGIN|END) CERTIFICATE-----/g, '').replace(/\s+/g, ''), modulusB64: b64(keys.privateKey.n), exponentB64: b64(keys.privateKey.e) }
writeFileSync('pub.pem', forge.pki.publicKeyToPem(keys.publicKey))
export const cargarCertificado = () => cred
export const obtenerToken = async () => 'TOKEN-DE-PRUEBA'
