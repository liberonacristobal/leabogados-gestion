// npm run verificar: build, lint, tipos, pruebas y recorrido de la demo, sin repetir lo ya comprobado.
//  · Si el código (lo versionado y lo nuevo sin ignorar) es EXACTAMENTE el de la última verificación en verde, no corre nada.
//  · El recorrido de la demo (lo lento, ~7 min) solo corre si cambió la app: src/, las reglas de _shared, las pantallas de prueba o la configuración.
//    Un cambio solo de pruebas, documentación o scripts de apoyo corre build, lint, tipos y pruebas (segundos) y no el recorrido.
//  · `npm run verificar -- --forzar` corre todo. La huella vive en .git/verificar-cache.json (no se versiona) y solo se guarda si todo salió en verde.
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'

const FORZAR = process.argv.includes('--forzar')
const CACHE = '.git/verificar-cache.json'
const APP = /^(src\/|supabase\/functions\/_shared\/|scripts\/smoke-demo\.mjs$|index\.html$|public\/|package(-lock)?\.json$|vite\.config\.|tsconfig|eslint|\.eslintrc)/

const sh = (cmd, args) => spawnSync(cmd, args, { encoding: 'buffer', maxBuffer: 64 * 1024 * 1024 })
const archivos = () => { const r = sh('git', ['ls-files', '-z', '-c', '-o', '--exclude-standard']); if (r.status !== 0) return null; return r.stdout.toString('utf8').split('\0').filter(Boolean).sort() }
const huella = lista => { const h = createHash('sha1'); for (const f of lista) { h.update(f + '\0'); try { h.update(readFileSync(f)) } catch (_) { h.update('∅') } h.update('\0') } return h.digest('hex') }

const lista = archivos()
const hTodo = lista ? huella(lista) : null
const hApp = lista ? huella(lista.filter(f => APP.test(f))) : null
let previo = {}; try { previo = JSON.parse(readFileSync(CACHE, 'utf8')) } catch (_) {}

if (!FORZAR && hTodo && previo.todo === hTodo) { console.log('✓ Verificación al día: este código ya se verificó en verde (nada que repetir). Para volver a correrla: npm run verificar -- --forzar'); process.exit(0) }
const correrSmoke = FORZAR || !hApp || previo.app !== hApp
const paso = (nombre, cmd, args, env = {}) => { console.log(`\n▶ ${nombre}`); const r = spawnSync(cmd, args, { stdio: 'inherit', env: { ...process.env, ...env } }); if (r.status !== 0) { console.error(`\n✗ Falló: ${nombre}`); process.exit(r.status || 1) } }

paso('build', 'npx', ['vite', 'build'])
paso('lint', 'npm', ['run', 'lint', '--silent'])
paso('tipos', 'npm', ['run', 'tipos', '--silent'])
paso('pruebas', 'npm', ['test', '--silent'])
if (correrSmoke) paso('recorrido de la demo', 'node', ['scripts/smoke-demo.mjs'], { VITE_CJS_IGNORE_WARNING: 'true' })
else console.log('\n⏭ Recorrido de la demo omitido: la app no cambió desde la última verificación en verde.')

if (hTodo && existsSync('.git')) { try { writeFileSync(CACHE, JSON.stringify({ todo: hTodo, app: hApp, cuando: new Date().toISOString() })) } catch (_) {} }
console.log('\n✓ Verificación en verde.')
