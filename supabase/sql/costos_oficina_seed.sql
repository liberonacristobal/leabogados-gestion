-- Carga inicial de Costos de Oficina desde el Presupuesto 2026 (LEA).
-- Correr DESPUÉS de costos_oficina.sql. Montos = valor mensual VIGENTE HOY (post cambio de oficina en marzo 2026).
-- Las líneas que subieron en marzo llevan desde='2026-03-01' + monto_prev (valor ene-feb), para que cada mes
-- sume con lo que regía ese mes. Los ítems anuales/puntuales van como run-rate mensual (anual ÷ 12), ajustables.
-- Revisa las cifras antes de correr (lleva sueldos). Idempotente aproximado: borra la carga previa por estudio 'lea'.

delete from costos_oficina where estudio_id = coalesce(mi_estudio(),'lea');

insert into costos_oficina (categoria, item, monto, es_ingreso, desde, monto_prev, orden) values
  -- Remuneraciones (costo empresa/mes; Martín ya con el aumento 2026)
  ('Remuneraciones','Cristóbal Liberona', 2330000, false, null, null, 1),
  ('Remuneraciones','Erasmo Escala',       2284500, false, null, null, 2),
  ('Remuneraciones','Martín Campero',       1679268, false, null, null, 3),
  ('Remuneraciones','Contadora',              65000, false, null, null, 4),
  ('Remuneraciones','Procurador',            450000, false, '2026-03-01', 0, 5),
  -- Leyes sociales (imposiciones/cotizaciones del empleador, por persona)
  ('Leyes sociales','Cristóbal Liberona',    630000, false, null, null, 10),
  ('Leyes sociales','Erasmo Escala',         680000, false, null, null, 11),
  ('Leyes sociales','Martín Campero',        440000, false, null, null, 12),
  ('Leyes sociales','Procurador',             81000, false, '2026-03-01', 0, 13),
  -- Impuestos y patentes
  ('Impuestos y patentes','PPM',             800000, false, null, null, 20),
  -- Arriendo y espacio (subió en marzo por cambio de oficina)
  ('Arriendo y espacio','Arriendo',         2780000, false, '2026-03-01', 780000, 30),
  ('Arriendo y espacio','Gastos comunes',    890000, false, '2026-03-01', 240000, 31),
  ('Arriendo y espacio','Limpieza',          270000, false, '2026-03-01', 150000, 32),
  ('Arriendo y espacio','Subarriendo',       900000, true,  null, null, 33),
  -- Servicios y tecnología
  ('Servicios y tecnología','Internet',       34200, false, null, null, 40),
  ('Servicios y tecnología','Google Workspace',90000, false, null, null, 41),
  ('Servicios y tecnología','ChatGPT',        20000, false, null, null, 42),
  -- Insumos de oficina (anuales llevados a run-rate mensual)
  ('Insumos de oficina','Agua y bebidas',     30000, false, null, null, 50),
  ('Insumos de oficina','Café y supermercado',35000, false, null, null, 51),
  ('Insumos de oficina','Artículos de oficina',7500, false, null, null, 52),
  -- Desarrollo de negocio (anuales / puntuales llevados a run-rate mensual)
  ('Desarrollo de negocio','Membresías',      30000, false, null, null, 60),
  ('Desarrollo de negocio','Regalos',         54167, false, null, null, 61),
  ('Desarrollo de negocio','Comidas y eventos',279167, false, null, null, 62);

notify pgrst, 'reload schema';

-- Quedan vacías a propósito (las cargas tú con montos reales):
--   Movilización y operación  (transporte, carga BIP, Ubers absorbidos)
--   Seguros y contingencias   (RC profesional / mala praxis, seguro oficina, provisión incobrables)
