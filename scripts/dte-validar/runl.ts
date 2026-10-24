import { armarLibroVentas } from './libro.ts'
import { writeFileSync } from 'node:fs'
const x = armarLibroVentas({ rutEmisor: '77700387-9', rutEnvia: '11111111-1', periodo: '2026-10', fchResol: '2014-08-22', nroResol: 0 },
  [{ tpoDoc: 34, nroDoc: 5, fchDoc: '2026-10-24', rutDoc: '76123456-7', rznSoc: 'Cliente de Prueba SpA', mntExe: 1200000, mntTotal: 1200000 },
   { tpoDoc: 61, nroDoc: 6, fchDoc: '2026-10-24', rutDoc: '76123456-7', rznSoc: 'Cliente de Prueba SpA', mntExe: 1200000, mntTotal: 1200000 }], '2026-10-24T16:00:00')
writeFileSync('libro.xml', x); console.log(x.slice(0, 300))
