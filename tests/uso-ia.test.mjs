// Registro de consumo de la IA: qué se guarda de cada llamada. Datos de ejemplo, sin contenido de mensajes.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { usoDe, errorDe, origenLimpio, filaUso } from './../supabase/functions/_shared/usoIA.js'

test('tokens: entrada, salida, caché y pensamiento; lo ausente o inválido cuenta cero', () => {
  const r = usoDe({ usage: { input_tokens: 12336, output_tokens: 1711, cache_read_input_tokens: 5, output_tokens_details: { thinking_tokens: 506 } } })
  assert.deepEqual(r, { entrada: 12336, salida: 1711, cache_lectura: 5, cache_escritura: 0, pensamiento: 506 })
  assert.deepEqual(usoDe(null), { entrada: 0, salida: 0, cache_lectura: 0, cache_escritura: 0, pensamiento: 0 })
  assert.equal(usoDe({ usage: { input_tokens: 'x', output_tokens: -4 } }).salida, 0)
})

test('falla: el mensaje de la API (tope de gasto) o el código HTTP; una llamada buena no tiene error', () => {
  assert.equal(errorDe({ error: { message: 'You have reached your specified API usage limits.' } }, 400), 'You have reached your specified API usage limits.')
  assert.equal(errorDe({}, 529), 'HTTP 529')
  assert.equal(errorDe({ usage: {} }, 200), null)
  assert.equal(errorDe({ error: { message: 'x'.repeat(500) } }).length, 200)
})

test('origen: solo letras, números y separadores, hasta 60 caracteres', () => {
  assert.equal(origenLimpio('CarteraView'), 'CarteraView')
  assert.equal(origenLimpio('<script>alert(1)</script>'), 'scriptalert1/script')
  assert.equal(origenLimpio('   '), null)
  assert.equal(origenLimpio(undefined), null)
  assert.equal(origenLimpio('a'.repeat(100)).length, 60)
})

test('fila: modelo de la respuesta si no se indica, usuario en minúscula, ok según el error', () => {
  const f = filaUso({ funcion: 'claude-proxy', data: { model: 'claude-haiku-5-5', usage: { input_tokens: 10, output_tokens: 2 } }, status: 200, usuario: 'CL@leabogados.cl', maxTokens: 300, origen: 'Dashboard', estudioId: 'lea' })
  assert.equal(f.modelo, 'claude-haiku-5-5'); assert.equal(f.usuario, 'cl@leabogados.cl'); assert.equal(f.ok, true)
  assert.equal(f.entrada, 10); assert.equal(f.max_tokens, 300); assert.equal(f.estudio_id, 'lea')
  const mala = filaUso({ funcion: 'x', modelo: 'm', data: { error: { message: 'tope' } }, status: 400 })
  assert.equal(mala.ok, false); assert.equal(mala.error, 'tope'); assert.equal('estudio_id' in mala, false)
})
