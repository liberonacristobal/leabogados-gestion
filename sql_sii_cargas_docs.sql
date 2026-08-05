-- Staging de la carga de XML del SII: guarda lo cargado aunque no se registre,
-- para poder salir y retomar después. Llave anti-duplicado: (folio, tipo_dte).
-- estado: sin_registrar (pendiente) | registrada (ya pasó a billing) | descartada.
CREATE TABLE IF NOT EXISTS sii_cargas_docs (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  folio         text NOT NULL,
  tipo_dte      int  NOT NULL DEFAULT 33,
  fecha_emision date,
  receptor_rut  text,
  receptor_name text,
  monto         bigint DEFAULT 0,
  glosa         text,
  doc_json      jsonb,          -- campos parseados del DTE (registrar sin re-subir)
  client_id     uuid,           -- cliente resuelto, si lo hubo
  estado        text NOT NULL DEFAULT 'sin_registrar',
  billing_id    uuid,           -- factura creada al registrar
  batch_id      uuid,           -- tanda de carga (sii_import_batches.id)
  created_by    text,
  created_at    timestamptz DEFAULT now(),
  updated_at    timestamptz DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS sii_cargas_docs_folio_tipo ON sii_cargas_docs (folio, tipo_dte);

GRANT ALL ON TABLE sii_cargas_docs TO authenticated, service_role;
ALTER TABLE sii_cargas_docs ENABLE ROW LEVEL SECURITY;
CREATE POLICY team_all ON sii_cargas_docs FOR ALL TO authenticated
  USING ((auth.jwt() ->> 'email') LIKE '%@leabogados.cl')
  WITH CHECK ((auth.jwt() ->> 'email') LIKE '%@leabogados.cl');
NOTIFY pgrst, 'reload schema';
