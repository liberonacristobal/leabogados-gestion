#!/bin/zsh
# Valida contra los esquemas oficiales del SII (copia pública de LibreDTE) lo que arma el motor de emisión
# (supabase/functions/sii-sync/dte.ts y libro.ts): factura exenta 34, nota de crédito 61, sobre EnvioDTE y Libro de Ventas.
# No firma con datos reales ni envía nada: CAF y firma son de prueba. Correr antes de certificar y cada vez que el SII cambie el formato.
set -e
AQUI="$(cd "$(dirname "$0")" && pwd)"; RAIZ="$AQUI/../.."; T="$(mktemp -d)"
for f in DTE_v10.xsd SiiTypes_v10.xsd xmldsignature_v10.xsd EnvioDTE_v10.xsd LibroCV_v10.xsd LceCal_v10.xsd LceCoCertif_v10.xsd LceSiiTypes_v10.xsd; do
  curl -sf -m 30 -o "$T/$f" "https://raw.githubusercontent.com/LibreDTE/libredte-lib-core/master/resources/schemas/$f"
done
echo "Esquema DTE: $(grep -m1 -o 'Fecha Actualizacion:[^<]*' "$T/DTE_v10.xsd")"
sed "s#import { CafParsed, firmarTED } from './caf.ts'#import { firmarTED } from './caf_stub.ts'\ntype CafParsed = any#" "$RAIZ/supabase/functions/sii-sync/dte.ts" > "$T/dte.ts"
FIRMA=$(grep -o "const sig = \`.*\`" "$AQUI/run.ts" | sed "s/^const sig = \`//; s/\`$//")
python3 - "$RAIZ/supabase/functions/sii-sync/libro.ts" "$T/libro.ts" "$FIRMA" <<'PY'
import sys; src=open(sys.argv[1]).read(); open(sys.argv[2],'w').write(src.replace("import { firmarReferencia } from './firma.ts'\n", "const firmarReferencia = (_e: string, _u: string) => '"+sys.argv[3]+"'\n"))
PY
cp "$AQUI/run.ts" "$AQUI/runl.ts" "$AQUI/caf_stub.ts" "$T/"
cd "$T" && node run.ts >/dev/null && node runl.ts >/dev/null
python3 - <<'PY'
import re
sig=re.search(r'<Signature.*</Signature>',open('dte_34.xml').read()).group(0)
dtes=[re.search(r'<DTE .*</DTE>',open(f).read()).group(0).replace(' xmlns="http://www.sii.cl/SiiDte"','') for f in ('dte_34.xml','dte_61.xml')]
car='<Caratula version="1.0"><RutEmisor>77700387-9</RutEmisor><RutEnvia>11111111-1</RutEnvia><RutReceptor>60803000-K</RutReceptor><FchResol>2014-08-22</FchResol><NroResol>0</NroResol><TmstFirmaEnv>2026-10-24T16:00:00</TmstFirmaEnv><SubTotDTE><TpoDTE>34</TpoDTE><NroDTE>1</NroDTE></SubTotDTE><SubTotDTE><TpoDTE>61</TpoDTE><NroDTE>1</NroDTE></SubTotDTE></Caratula>'
open('envio.xml','w').write('<?xml version="1.0" encoding="UTF-8"?><EnvioDTE xmlns="http://www.sii.cl/SiiDte" version="1.0"><SetDTE ID="SetDoc">'+car+''.join(dtes)+'</SetDTE>'+sig+'</EnvioDTE>')
PY
xmllint --noout --schema DTE_v10.xsd dte_34.xml dte_61.xml
xmllint --noout --schema EnvioDTE_v10.xsd envio.xml
xmllint --noout --schema LibroCV_v10.xsd libro.xml
