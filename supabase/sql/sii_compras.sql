-- sii_compras_docs — Registro de Compras del SII (documentos tributarios RECIBIDOS
-- por la sociedad). Mirror de sii_cargas_docs pero orientado a compras: aqui el
-- estudio es el RECEPTOR y el proveedor es el EMISOR. Solo LECTURA/sincronizacion
-- (lo llena la edge function sii-sync via getDetalleCompra); NADA de emision.
--
-- Llave anti-duplicado: (folio, tipo_dte, emisor_rut, periodo). Un mismo folio se
-- repite entre distintos emisores, por eso el emisor entra en la llave; y el mismo
-- documento puede aparecer al re-sincronizar un periodo, de ahi el upsert idempotente.
--
-- estado: 'sin_conciliar' (default) -> pendiente de cruzar con el banco.
CREATE TABLE IF NOT EXISTS sii_compras_docs (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  folio         text,
  tipo_dte      int,
  fecha_emision date,
  emisor_rut    text,           -- RUT del proveedor (emisor del documento)
  emisor_name   text,           -- razon social del proveedor
  neto          bigint DEFAULT 0,
  exento        bigint DEFAULT 0,
  iva           bigint DEFAULT 0,
  monto         bigint DEFAULT 0, -- monto total del documento
  glosa         text,
  doc_json      jsonb,          -- fila cruda del RCV (auditar sin re-consultar)
  proveedor_id  uuid,           -- match por RUT contra proveedores (si lo hubo)
  movimiento_id uuid,           -- conciliacion con el banco a futuro
  estado        text DEFAULT 'sin_conciliar',
  periodo       text,           -- YYYY-MM del periodo tributario consultado
  created_at    timestamptz DEFAULT now(),
  estudio_id    text
);

-- Llave anti-duplicado para el upsert idempotente del sync.
CREATE UNIQUE INDEX IF NOT EXISTS sii_compras_docs_dedupe
  ON sii_compras_docs (folio, tipo_dte, emisor_rut, periodo);

-- RLS estandar del proyecto (team_all: solo @leabogados.cl autenticados).
GRANT ALL ON TABLE sii_compras_docs TO authenticated, service_role;
ALTER TABLE sii_compras_docs ENABLE ROW LEVEL SECURITY;
CREATE POLICY team_all ON sii_compras_docs FOR ALL TO authenticated
  USING ((auth.jwt() ->> 'email') LIKE '%@leabogados.cl')
  WITH CHECK ((auth.jwt() ->> 'email') LIKE '%@leabogados.cl');
NOTIFY pgrst, 'reload schema';
