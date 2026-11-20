// Revisa que ningún archivo versionado nombre a un cliente real (el repositorio es público: ver «repo público» en CLAUDE.md).
// La lista de nombres NO está en el repositorio: se lee de FIRMDESK_NOMBRES o de ~/.firmdesk-nombres-clientes.txt (una palabra o nombre por línea).
// Sin lista local no revisa (avisa y sigue). Coincidencia por palabra completa, sin distinguir mayúsculas ni tildes.
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const RUTA = process.env.FIRMDESK_NOMBRES || join(homedir(), '.firmdesk-nombres-clientes.txt')
if (!existsSync(RUTA)) { console.log('⏭ Revisión de nombres de clientes omitida: no hay lista local (' + RUTA + ').'); process.exit(0) }
const plano = s => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
const nombres = [...new Set(readFileSync(RUTA, 'utf8').split('\n').map(x => plano(x.trim())).filter(x => x.length >= 4))].sort((a, b) => b.length - a.length)
if (!nombres.length) { console.log('⏭ La lista local de nombres está vacía.'); process.exit(0) }
const rx = new RegExp('(?<![a-z0-9])(' + nombres.map(n => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')(?![a-z0-9])')
const lista = spawnSync('git', ['ls-files', '-z'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).stdout.split('\0').filter(Boolean)
const OMITIR = /(^|\/)(package-lock\.json|.*\.(png|jpe?g|gif|ico|pdf|xlsx?|woff2?|map))$/i
const hallazgos = []
for (const f of lista) {
  if (OMITIR.test(f) || !existsSync(f)) continue
  try { if (statSync(f).size > 3 * 1024 * 1024) continue } catch (_) { continue }
  let txt; try { txt = readFileSync(f, 'utf8') } catch (_) { continue }
  if (txt.includes('\0')) continue
  txt.split('\n').forEach((l, i) => { const m = rx.exec(plano(l)); if (m) hallazgos.push(`${f}:${i + 1}  «${m[1]}»`) })
}
if (hallazgos.length) {
  console.error('✗ Hay nombres de clientes en archivos versionados (el repositorio es público):')
  hallazgos.slice(0, 40).forEach(h => console.error('   ' + h))
  if (hallazgos.length > 40) console.error(`   … y ${hallazgos.length - 40} más`)
  console.error('Anonimízalos (p. ej. «[cliente]» o un nombre inventado) o, si es una palabra común, quítala de ' + RUTA + '.')
  process.exit(1)
}
console.log('✓ Sin nombres de clientes en los archivos versionados.')
