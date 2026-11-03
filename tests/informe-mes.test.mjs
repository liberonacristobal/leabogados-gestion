// Informe del mes: comparación, estados por reglas, resumen para la IA y verificación del texto. Casos sin nombres de clientes.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { variacion, filasComparacion, masMovidos, textoVariacion, estadosTemas, construirDossier, verificarTexto, leerInformeIA, textoDeInforme, TEMAS } from '../supabase/functions/_shared/informeMes.js'

const m = { ing: 24800000, cobrado: 26300000, cos: 8100000, com: 5300000, res: 11400000, margen: 46, ventasUF: 640, ventasN: 4, retiros: 0 }
const p = { ing: 21200000, cobrado: 19900000, cos: 7900000, com: 4100000, res: 9200000, margen: 43, ventasUF: 410, ventasN: 3, retiros: 11000000 }

test('variación: tono según lo que es bueno, neutro en retiros y sin base no inventa porcentaje', () => {
  assert.equal(variacion(120, 100, true).tono, 'up'); assert.equal(variacion(120, 100, false).tono, 'dn'); assert.equal(variacion(120, 100, null).tono, 'nt')
  assert.equal(variacion(50, 0, true).pct, null); assert.equal(variacion(null, 10).abs, null); assert.equal(variacion(100, 100).tono, 'nt')
})

test('comparación: cada indicador con su variación y texto', () => {
  const filas = filasComparacion({ m, p }), r = k => filas.find(x => x.k === k)
  assert.equal(filas.length, 9)
  assert.equal(textoVariacion(r('ing')), '+17%'); assert.equal(textoVariacion(r('cobrado')), '+32%'); assert.equal(textoVariacion(r('cos')), '+3%')
  assert.equal(textoVariacion(r('margen')), '+3 pts'); assert.equal(textoVariacion(r('retiros')), '−100%')
  assert.equal(r('cos').tono, 'dn'); assert.equal(r('res').tono, 'up'); assert.equal(r('retiros').tono, 'nt')
})

test('más movidos: de mayor a menor, sin márgenes en puntos y sin cambios menores al 5%', () => {
  const top = masMovidos(filasComparacion({ m, p }), 3)
  assert.deepEqual(top.map(f => f.k), ['retiros', 'ventasUF', 'ventasN'])   // −100%, +56%, +33%
  assert.equal(masMovidos(filasComparacion({ m: { ing: 100 }, p: { ing: 101 } })).length, 0)
})

test('estados por tema: reglas fijas, no las decide la IA', () => {
  const filas = filasComparacion({ m, p })
  const e = estadosTemas({ filas, pctVencido: 0.72, comisionDias: 62, flujo: -40, difRetiros: 0 })
  assert.deepEqual(e, { resultado: 'mejora', cobranza: 'riesgo', ventas: 'mejora', comisiones: 'atencion', retiros: 'sin_cambio', liquidez: 'riesgo' })
  assert.equal(estadosTemas({ filas, pctVencido: 0.2, comisionDias: 10, flujo: 5, difRetiros: 1000 }).retiros, 'atencion')
  assert.equal(estadosTemas({ filas: filasComparacion({ m: { res: -5 }, p: { res: 3 } }) }).resultado, 'riesgo')
})

const f = { clp: n => `$${(n / 1e6).toLocaleString('es-CL', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}M`, uf: n => `UF ${Math.round(n).toLocaleString('es-CL')}`, n: n => String(n), pts: n => `${n}%` }
const dossier = construirDossier({ mes: 'octubre 2026', comparado: 'septiembre 2026', filas: filasComparacion({ m, p }), f, extras: { vencido: '$43,7M', pctVencido: '72%', flujo8semanas: '−$40,4M', semanas: 8 } })

test('verificación del texto: pasa si todo número está en el resumen y falla con una cifra inventada', () => {
  assert.equal(verificarTexto('El resultado llega a $11,4M, con margen de 46% y un alza de 88%.', dossier).ok, false)   // 88 no está en el resumen
  assert.equal(verificarTexto('El resultado llega a $11,4M con un margen de 46%; el vencido es $43,7M (72%) y el flujo a 8 semanas −$40,4M.', dossier).ok, true)
  const mala = verificarTexto('Los ingresos suben 99% a $24,8M', dossier)
  assert.equal(mala.ok, false); assert.deepEqual(mala.faltantes, ['99'])
})

test('el texto puede nombrar los plazos de la app (60 días de mora, 30 de pago, 8 semanas) pero no otros números', () => {
  assert.equal(verificarTexto('Hay $43,7M vencidos, con pagos a 30 días y más de 60 días de mora; el flujo a 8 semanas es −$40,4M.', dossier).ok, true)
  assert.equal(verificarTexto('Con más de 75 días de mora.', dossier).ok, false)
})

test('lectura del informe de la IA: exige 6 puntos en el orden fijo y acepta cercos de código', () => {
  const puntos = TEMAS.map(t => ({ tema: t, cifra: '$1M', etiqueta: 'x', variacion: '+1%', titular: 'T', porque: 'P', enlace: 'estadoResultados' }))
  const ok = leerInformeIA('```json\n' + JSON.stringify({ frase: 'Buen mes', puntos }) + '\n```')
  assert.equal(ok.puntos.length, 6); assert.match(textoDeInforme(ok), /Buen mes/)
  assert.equal(leerInformeIA(JSON.stringify({ frase: 'x', puntos: puntos.slice(0, 5) })), null)
  assert.equal(leerInformeIA(JSON.stringify({ frase: 'x', puntos: [...puntos].reverse() })), null)
  const conMayuscula = leerInformeIA(JSON.stringify({ frase: 'x', puntos: TEMAS.map(t => ({ tema: t[0].toUpperCase() + t.slice(1), titular: 'T', porque: 'P' })) }))
  assert.equal(conMayuscula.puntos[0].tema, 'resultado'); assert.equal(conMayuscula.puntos[0].cifra, '')   // tolera mayúsculas y campos ausentes
  assert.equal(leerInformeIA('no es json'), null)
})
