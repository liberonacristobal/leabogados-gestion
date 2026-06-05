// Ejecuta el seed de clientes (equivalente a seed-clientes-drive.sql) usando la
// service role key, que omite RLS. La clave se lee desde la variable de entorno
// SUPABASE_SERVICE_ROLE_KEY — NUNCA se hardcodea aquí.
//
// Uso (con el prefijo `!` para que la clave quede solo en tu sesión local):
//   ! SUPABASE_SERVICE_ROLE_KEY='tu-service-role-key' node scripts/seed-clients.mjs
//
import { createClient } from '@supabase/supabase-js'

const url = process.env.SUPABASE_URL || 'https://kibuwhtpoxrnfowfdolu.supabase.co'
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!key) {
  console.error('❌ Falta SUPABASE_SERVICE_ROLE_KEY. Corre:\n   ! SUPABASE_SERVICE_ROLE_KEY=\'...\' node scripts/seed-clients.mjs')
  process.exit(1)
}

// Forzar el header Authorization con la service key garantiza que PostgREST
// haga SET ROLE service_role (que bypassa RLS), sin depender de una sesión.
const supabase = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
  global: { headers: { Authorization: `Bearer ${key}`, apikey: key } },
})

const die = (label, err) => {
  console.error(`❌ ${label}:`, err.message)
  if (err.code || err.details || err.hint) console.error('   ', { code: err.code, details: err.details, hint: err.hint })
  process.exit(1)
}

const ACTIVOS = [
  'Agustín Cabañas','Alejandro Lee','Alvaro Becerra','Anamaría Schiaffino','Andrés Kemeny',
  'Andro Sekul','Ariel Vaisman','Arturo Galvez','Aurus','Barbara - Belga','BM Soluciones',
  'Bohme','Bravo Silva','Carolina Balvidares','China Railway','Clínica Vet. Chicureo',
  'Corporación Derecho Registral','Cristian Bustos','Daniel Abragan','Dante Bacigalupo',
  'David Migdley','Eduardo Astete','Eduardo Barra','Electroson','Familia Schroder',
  'Francisco Saavedra','Freddy Bravo','Fuad Hamed','Gabriela del Fierro','Gallegos',
  'Germán Armas','Geslog','Gloria Cheyre','Golf','Grupo Avanza','Hotel San Martín',
  'Hugo Figueroa','Ivan Rivas','Jasna Misetic','Javier Borquez','Javier Vergara',
  'Javiera Diaz','José Miguel Delgado','Juan Pablo Martinez','Lorena Olcese','Luis Silva',
  'Lukas Mimica','Macarron','Maria Paz Gidi','Mario Cabezon','Mario Vergara','Mi Market',
  'Miriam Hamed','Mobilitex','Nicolás Martínez','Pablo Liberona','QUAD','Rodrigo Jaramillo',
  'Soraya Jadue','SSIAL','Suegro','Tarragona','Tomas Gonzalez','Toselli','TryCloud','UDALBA',
  'Vasa','Vecchiola','VentiPay','Víctor Lazo','Vittorio Stacchetti',
]
const TERM_2024 = ['Catherine Cordomi','Carlos Barros','Egon Buchwald','Carolina Letelier']
const TERM_2025 = [
  'Patricia Pérez','Juan Pablo Merello','Inversiones Encina','Scrigna','Karla Itaim',
  'Fernando Vidal','Rafael Raveau','Martín Artorquiza','Drims Beauty','Rosa Hadwad',
  'Elisa Agostini','Rendalo SpA','Daniela Muñoz','Paulina Corte',
]

const rows = [
  ...ACTIVOS.map(name => ({ name, status: 'Activo' })),
  ...TERM_2024.map(name => ({ name, status: 'Terminado', notes: 'Archivado 2024' })),
  ...TERM_2025.map(name => ({ name, status: 'Terminado', notes: 'Archivado 2025' })),
]

console.log(`Preparados ${rows.length} clientes (${ACTIVOS.length} activos + ${TERM_2024.length + TERM_2025.length} terminados)`)

// 0) Chequeo de conexión/rol: cuántos clientes hay ahora
const { count: before, error: cntErr } = await supabase.from('clients').select('*', { count: 'exact', head: true })
if (cntErr) die('Error al leer (conexión/rol)', cntErr)
console.log(`🔌 Conectado. Clientes actuales: ${before}`)

// 1) Borrar todos los clientes actuales (CASCADE elimina matters y billing)
const { error: delErr } = await supabase.from('clients').delete().not('id', 'is', null)
if (delErr) die('Error al borrar', delErr)
console.log('🗑️  Clientes anteriores eliminados')

// 2) Insertar los 89 clientes
const { data: inserted, error: insErr } = await supabase.from('clients').insert(rows).select('id')
if (insErr) die('Error al insertar', insErr)
console.log(`✅ Insertados ${inserted.length} clientes`)

// 3) Verificación
const { data: all, error: selErr } = await supabase.from('clients').select('status')
if (selErr) die('Error al verificar', selErr)
const tally = all.reduce((a, c) => { a[c.status] = (a[c.status] || 0) + 1; return a }, {})
console.log('📊 Conteo final:', tally, '(esperado: Activo 71 / Terminado 18)')
