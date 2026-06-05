import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)

// ─── AUTH ─────────────────────────────────────────────────────────────────────
export const signInWithGoogle = () =>
  supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      queryParams: { hd: 'leabogados.cl' }, // Solo permite cuentas @leabogados.cl
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
  // deduplicar por nombre
  const seen = new Set()
  return data.filter(e => {
    if (seen.has(e.name.toLowerCase())) return false
    seen.add(e.name.toLowerCase())
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
      queryParams: { hd: 'leabogados.cl', access_type: 'offline' },
      scopes: 'https://www.googleapis.com/auth/drive.readonly',
      redirectTo: window.location.origin,
    }
  })

// ── DRIVE: guardar token en localStorage al hacer login ──────────────────────
export const getDriveTokenStored = () => localStorage.getItem('drive_token')
export const saveDriveToken = (token) => localStorage.setItem('drive_token', token)
