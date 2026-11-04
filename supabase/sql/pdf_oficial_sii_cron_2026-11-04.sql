-- 2026-11-04 · PDF oficial del SII de cada factura emitida: se guarda solo en Drive (Facturación/año/mes) y como adjunto «PDF oficial SII».
-- Acción 'pdf-oficial' de sii-sync (solo LEE el SII). Cron cada hora entre las 08:50 y las 20:50 de Chile; el calendario de reintentos
-- (6 horas, luego uno por día; aviso por push a la 3ª falla) vive en _shared/pdfOficialReglas.js. Estado de reintentos: learnings
-- 'pdf_oficial_intentos' (hits = intentos, meta.at/meta.ultimo) y 'pdf_oficial_aviso' (ya avisada).
select cron.schedule('pdf-oficial-sii', '50 11-23 * * *', replace(replace((select command from cron.job where jobname='xml-emitidos-sii'), 'xml-emitidos-sii', 'pdf-oficial-sii'), '"action":"xml-emitidos"', '"action":"pdf-oficial"'));
insert into procesos_catalogo (jobname, nombre, estudio_id, reintentable) values ('pdf-oficial-sii', 'PDF oficial de las facturas emitidas (SII → Drive)', 'lea', true) on conflict do nothing;
