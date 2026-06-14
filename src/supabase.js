import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY

// Modo demo (?demo=1): salta el login y usa datos ficticios. El cliente queda INERTE para
// garantizar que NINGUNA lectura/escritura toque la base real (toda llamada resuelve vacío/no-op).
export const DEMO = typeof window!=='undefined' && new URLSearchParams(window.location.search).get('demo')==='1'

const ok = (data=null) => Promise.resolve({ data, error: null })
function demoQuery(){
  const b = {}
  const chain = () => b
  ;['select','insert','update','upsert','delete','eq','neq','in','is','not','or','and','gte','lte','gt','lt','like','ilike','filter','match','order','limit','range','contains','overlaps'].forEach(m=>{ b[m]=chain })
  b.single = () => ok(null)
  b.maybeSingle = () => ok(null)
  b.then = (f,r) => ok([]).then(f,r)
  b.catch = (f) => ok([]).catch(f)
  b.finally = (f) => ok([]).finally(f)
  return b
}
const demoClient = {
  supabaseKey: '',
  from: () => demoQuery(),
  auth: {
    getSession: () => ok({ session: { user:{ email:'demo@demo.cl' }, access_token:'demo' } }),
    getUser: () => ok({ user:{ email:'demo@demo.cl' } }),
    onAuthStateChange: () => ({ data:{ subscription:{ unsubscribe(){} } } }),
    signInWithOAuth: () => ok({}),
    signOut: () => ok({}),
  },
  storage: { from: () => ({ upload: async()=>({data:null,error:null}), remove: async()=>({error:null}), getPublicUrl: () => ({ data:{ publicUrl:'' } }), createSignedUrl: async()=>({ data:{ signedUrl:'' }, error:null }) }) },
  channel: () => ({ on(){ return this }, subscribe(){ return this } }),
  removeChannel: () => {},
}

export const supabase = DEMO ? demoClient : createClient(SUPABASE_URL, SUPABASE_ANON_KEY)

// ─── AUTH ─────────────────────────────────────────────────────────────────────
export const signInWithGoogle = () =>
  supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      queryParams: { hd: 'leabogados.cl', access_type: 'offline', prompt: 'consent' },
      scopes: 'https://www.googleapis.com/auth/drive https://www.googleapis.com/auth/gmail.send',
      redirectTo: window.location.origin,
    },
  })

export const signOut = () => supabase.auth.signOut()

export const getSession = () => supabase.auth.getSession()

export const onAuthChange = (cb) => supabase.auth.onAuthStateChange(cb)

// ─── ROLES POR EMAIL ──────────────────────────────────────────────────────────
const ROLES = {
  'cl@leabogados.cl':      { name: 'Cristóbal', role: 'admin' },
  'martin@leabogados.cl':  { name: 'Martín',    role: 'abogado' },
  'erasmo@leabogados.cl':  { name: 'Erasmo',    role: 'abogado' },
  'martina@leabogados.cl': { name: 'Martina',   role: 'asistente' },
  'rodrigo@leabogados.cl': { name: 'Rodrigo',   role: 'abogado' },
}

export const getUserInfo = (email) =>
  ROLES[email] || { name: email?.split('@')[0] || 'Usuario', role: 'viewer' }

// ─── CLIENTES ─────────────────────────────────────────────────────────────────
export const getClients = async () => {
  const { data, error } = await supabase
    .from('clients')
    .select('*')
    .order('name')
  if (error) throw error
  return data
}

export const upsertClient = async (client) => {
  const { data, error } = await supabase
    .from('clients')
    .upsert(client, { onConflict: 'id' })
    .select()
    .single()
  if (error) throw error
  return data
}

export const deleteClient = async (id) => {
  const { error } = await supabase.from('clients').delete().eq('id', id)
  if (error) throw error
}

// ─── ENTIDADES FACTURABLES (razones sociales por cliente) ──────────────────────
export const getClientEntities = async (clientId) => {
  const { data, error } = await supabase
    .from('client_entities')
    .select('*')
    .eq('client_id', clientId)
    .order('name')
  if (error) throw error
  return data
}

export const upsertClientEntity = async (entity) => {
  const { data, error } = await supabase
    .from('client_entities')
    .upsert(entity, { onConflict: 'id' })
    .select()
    .single()
  if (error) throw error
  return data
}

export const deleteClientEntity = async (id) => {
  const { error } = await supabase.from('client_entities').delete().eq('id', id)
  if (error) throw error
}

// ─── ASUNTOS ──────────────────────────────────────────────────────────────────
export const getMatters = async () => {
  const { data, error } = await supabase
    .from('matters')
    .select('*, clients(name, erasmo)')
    .order('due', { ascending: true, nullsLast: true })
  if (error) throw error
  return data
}

export const upsertMatter = async (matter) => {
  const { data, error } = await supabase
    .from('matters')
    .upsert(matter, { onConflict: 'id' })
    .select()
    .single()
  if (error) throw error
  return data
}

export const deleteMatter = async (id) => {
  const { error } = await supabase.from('matters').delete().eq('id', id)
  if (error) throw error
}

// ─── COBROS ───────────────────────────────────────────────────────────────────
export const getBilling = async () => {
  const { data, error } = await supabase
    .from('billing')
    .select('*, clients(name, erasmo)')
    .is('deleted_at', null)
    .order('due', { ascending: true, nullsLast: true })
  if (error) throw error
  return data
}

export const upsertBilling = async (bill) => {
  const { data, error } = await supabase
    .from('billing')
    .upsert(bill, { onConflict: 'id' })
    .select()
    .single()
  if (error) throw error
  return data
}

export const deleteBilling = async (id) => {
  const { error } = await supabase.from('billing').delete().eq('id', id)
  if (error) throw error
}

export const updateBillingStatus = async (id, status) => {
  const { error } = await supabase
    .from('billing')
    .update({ status, updated_at: new Date().toISOString() })
    .eq('id', id)
  if (error) throw error
}

// ── ENTIDADES: todas para autocomplete ──────────────────────────────────────
export const getAllEntities = async () => {
  const { data, error } = await supabase
    .from('client_entities')
    .select('id, name, rut')
    .order('name')
  if (error) throw error
  // deduplicar por nombre (ignora entidades sin nombre para no romper el autocomplete)
  const seen = new Set()
  return data.filter(e => {
    if (!e.name) return false
    const k = e.name.toLowerCase()
    if (seen.has(k)) return false
    seen.add(k)
    return true
  })
}

// ── DRIVE: obtener token con scope de Drive ──────────────────────────────────
export const getDriveToken = async () => {
  const { data: { session } } = await supabase.auth.getSession()
  return session?.provider_token || null
}

export const connectDrive = () =>
  supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      queryParams: { hd: 'leabogados.cl', access_type: 'offline', prompt: 'consent' },
      scopes: 'https://www.googleapis.com/auth/drive https://www.googleapis.com/auth/gmail.send',
      redirectTo: window.location.origin,
    }
  })

// ── DRIVE: guardar token en localStorage al hacer login ──────────────────────
export const getDriveTokenStored = () => localStorage.getItem('drive_token')
export const saveDriveToken = (token) => localStorage.setItem('drive_token', token)
