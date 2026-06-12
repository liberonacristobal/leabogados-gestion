// config.ts — ambientes y endpoints del SII.
//
// La danza de autenticacion (semilla -> firma -> token) corre contra DTEWS (Apache Axis):
//   produccion:    https://palena.sii.cl/DTEWS
//   certificacion: https://maullin.sii.cl/DTEWS
//
// El RCV (Registro de Compras y Ventas) SOLO existe en produccion (www4.sii.cl):
// un token de maullin no sirve para consultarlo. El ambiente 'certificacion'
// sirve para validar la firma y la danza sin riesgo; el sync real requiere
// SII_AMBIENTE=produccion (es solo LECTURA del registro, no emite nada).

export type Ambiente = 'certificacion' | 'produccion'

export function getConfig() {
  const ambiente = (Deno.env.get('SII_AMBIENTE') || 'certificacion') as Ambiente
  const dteBase = ambiente === 'produccion'
    ? 'https://palena.sii.cl/DTEWS'
    : 'https://maullin.sii.cl/DTEWS'
  return {
    ambiente,
    rutEmpresa: Deno.env.get('SII_RUT_EMPRESA') || '',
    certB64: Deno.env.get('SII_CERT_B64') || '',
    certPassword: Deno.env.get('SII_CERT_PASSWORD') || '',
    seedUrl: `${dteBase}/CrSeed.jws`,
    tokenUrl: `${dteBase}/GetTokenFromSeed.jws`,
    rcvUrl: 'https://www4.sii.cl/consdcvinternetui/services/data/facadeService/getDetalleCompraVenta',
    timeoutMs: 30000,
  }
}

// TODO FASE 2 (emision de DTEs — NO implementada): agregar aqui los endpoints
// de envio (palena|maullin /cgi_dte/UPL/DTEUpload) y timbraje/folios CAF.
// La danza de auth.ts se reutiliza tal cual; la emision vivira en emision.ts.
