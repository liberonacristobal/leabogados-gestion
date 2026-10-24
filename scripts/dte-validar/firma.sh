#!/bin/zsh
# Prueba de FIRMAS del motor de emisión: arma un EnvioDTE (factura 34 + nota de crédito 61) y un Libro de Ventas con el código real,
# firmados con una llave de PRUEBA, con texto acentuado, guardados en ISO-8859-1, y verifica cada firma con lxml + cryptography.
# También arma y verifica las tres respuestas del intercambio de información (intercambio.ts).
# Complementa validar.sh (esquemas). Correr antes del set de pruebas y tras cualquier cambio en dte.ts, firma.ts, emision.ts o libro.ts.
set -e
AQUI="$(cd "$(dirname "$0")" && pwd)"; RAIZ="$AQUI/../.."; T="$(mktemp -d)"; S="$RAIZ/supabase/functions/sii-sync"
cd "$T" && printf '{"type":"module"}' > package.json && npm i -s node-forge@1.3.1 >/dev/null
for f in dte.ts firma.ts emision.ts libro.ts intercambio.ts; do sed -e "s#import forge from 'forge'#import forge from 'node-forge'#" -e "s#from './auth.ts'#from './firma_auth_stub.ts'#" "$S/$f" > "$T/$f"; done
sed -i '' -e "s#import { CafParsed, firmarTED } from './caf.ts'#import { firmarTED } from './caf_stub.ts'\ntype CafParsed = any#" "$T/dte.ts"
printf "export const getConfig = (_u?: string) => ({} as any)\n" > "$T/config.ts"
printf "export const fetchSII = async () => { throw new Error('sin red') }\nexport const conReintentos = async (_p: string, f: any) => f()\n" > "$T/http.ts"
cp "$AQUI/caf_stub.ts" "$AQUI/firma_auth_stub.ts" "$AQUI/firma_gen.ts" "$T/"
node firma_gen.ts >/dev/null
python3 -I "$AQUI/firma_verify.py" envio_firmado.xml libro_firmado.xml resp_recepcion.xml resp_resultado.xml resp_recibos.xml
for f in DTE_v10.xsd SiiTypes_v10.xsd xmldsignature_v10.xsd EnvioDTE_v10.xsd LibroCV_v10.xsd LceCal_v10.xsd LceCoCertif_v10.xsd LceSiiTypes_v10.xsd RespuestaEnvioDTE_v10.xsd EnvioRecibos_v10.xsd Recibos_v10.xsd; do
  curl -sf -m 30 -o "$T/$f" "https://raw.githubusercontent.com/LibreDTE/libredte-lib-core/master/resources/schemas/$f"
done
xmllint --noout --schema EnvioDTE_v10.xsd envio_firmado.xml
xmllint --noout --schema LibroCV_v10.xsd libro_firmado.xml
xmllint --noout --schema RespuestaEnvioDTE_v10.xsd resp_recepcion.xml resp_resultado.xml
xmllint --noout --schema EnvioRecibos_v10.xsd resp_recibos.xml
