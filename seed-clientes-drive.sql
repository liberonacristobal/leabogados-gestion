-- ═══════════════════════════════════════════════════════════════
-- LIBERONA ESCALA ABOGADOS — Clientes reales desde Google Drive
-- Fuente: Unidades Compartidas > Liberona Escala Abogados >
--         Compartido Liberona Escala Abogados > Clientes
-- 89 clientes: 71 Activos + 18 Terminados
-- Generado: 2026-06-04
--
-- ⚠️  El DELETE dispara ON DELETE CASCADE: elimina TODOS los matters
--     (asuntos) y billing (cobros) asociados a los clientes actuales.
--     Si NO quieres borrar lo existente, elimina la línea `delete`.
--     Ejecutar en: supabase.com → SQL Editor → New query → Run
-- ═══════════════════════════════════════════════════════════════

-- Parte de cero (evita duplicados; name no tiene restricción unique).
delete from clients;

-- ─── CLIENTES ACTIVOS (71) ──────────────────────────────────────────
insert into clients (name, status) values
  ('Agustín Cabañas','Activo'),
  ('Alejandro Lee','Activo'),
  ('Alvaro Becerra','Activo'),
  ('Anamaría Schiaffino','Activo'),
  ('Andrés Kemeny','Activo'),
  ('Andro Sekul','Activo'),
  ('Ariel Vaisman','Activo'),
  ('Arturo Galvez','Activo'),
  ('Aurus','Activo'),
  ('Barbara - Belga','Activo'),
  ('BM Soluciones','Activo'),
  ('Bohme','Activo'),
  ('Bravo Silva','Activo'),
  ('Carolina Balvidares','Activo'),
  ('China Railway','Activo'),
  ('Clínica Vet. Chicureo','Activo'),
  ('Corporación Derecho Registral','Activo'),
  ('Cristian Bustos','Activo'),
  ('Daniel Abragan','Activo'),
  ('Dante Bacigalupo','Activo'),
  ('David Migdley','Activo'),
  ('Eduardo Astete','Activo'),
  ('Eduardo Barra','Activo'),
  ('Electroson','Activo'),
  ('Familia Schroder','Activo'),
  ('Francisco Saavedra','Activo'),
  ('Freddy Bravo','Activo'),
  ('Fuad Hamed','Activo'),
  ('Gabriela del Fierro','Activo'),
  ('Gallegos','Activo'),
  ('Germán Armas','Activo'),
  ('Geslog','Activo'),
  ('Gloria Cheyre','Activo'),
  ('Golf','Activo'),
  ('Grupo Avanza','Activo'),
  ('Hotel San Martín','Activo'),
  ('Hugo Figueroa','Activo'),
  ('Ivan Rivas','Activo'),
  ('Jasna Misetic','Activo'),
  ('Javier Borquez','Activo'),
  ('Javier Vergara','Activo'),
  ('Javiera Diaz','Activo'),
  ('José Miguel Delgado','Activo'),
  ('Juan Pablo Martinez','Activo'),
  ('Lorena Olcese','Activo'),
  ('Luis Silva','Activo'),
  ('Lukas Mimica','Activo'),
  ('Macarron','Activo'),
  ('Maria Paz Gidi','Activo'),
  ('Mario Cabezon','Activo'),
  ('Mario Vergara','Activo'),
  ('Mi Market','Activo'),
  ('Miriam Hamed','Activo'),
  ('Mobilitex','Activo'),
  ('Nicolás Martínez','Activo'),
  ('Pablo Liberona','Activo'),
  ('QUAD','Activo'),
  ('Rodrigo Jaramillo','Activo'),
  ('Soraya Jadue','Activo'),
  ('SSIAL','Activo'),
  ('Suegro','Activo'),
  ('Tarragona','Activo'),
  ('Tomas Gonzalez','Activo'),
  ('Toselli','Activo'),
  ('TryCloud','Activo'),
  ('UDALBA','Activo'),
  ('Vasa','Activo'),
  ('Vecchiola','Activo'),
  ('VentiPay','Activo'),
  ('Víctor Lazo','Activo'),
  ('Vittorio Stacchetti','Activo');

-- ─── CLIENTES TERMINADOS — archivo 2024 (4) ─────────────────────────
insert into clients (name, status, notes) values
  ('Catherine Cordomi','Terminado','Archivado 2024'),
  ('Carlos Barros','Terminado','Archivado 2024'),
  ('Egon Buchwald','Terminado','Archivado 2024'),
  ('Carolina Letelier','Terminado','Archivado 2024');

-- ─── CLIENTES TERMINADOS — archivo 2025 (14) ────────────────────────
insert into clients (name, status, notes) values
  ('Patricia Pérez','Terminado','Archivado 2025'),
  ('Juan Pablo Merello','Terminado','Archivado 2025'),
  ('Inversiones Encina','Terminado','Archivado 2025'),
  ('Scrigna','Terminado','Archivado 2025'),
  ('Karla Itaim','Terminado','Archivado 2025'),
  ('Fernando Vidal','Terminado','Archivado 2025'),
  ('Rafael Raveau','Terminado','Archivado 2025'),
  ('Martín Artorquiza','Terminado','Archivado 2025'),
  ('Drims Beauty','Terminado','Archivado 2025'),
  ('Rosa Hadwad','Terminado','Archivado 2025'),
  ('Elisa Agostini','Terminado','Archivado 2025'),
  ('Rendalo SpA','Terminado','Archivado 2025'),
  ('Daniela Muñoz','Terminado','Archivado 2025'),
  ('Paulina Corte','Terminado','Archivado 2025');

-- Verificación (esperado: Activo 71 / Terminado 18)
select status, count(*) from clients group by status order by status;
