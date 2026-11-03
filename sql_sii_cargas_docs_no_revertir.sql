-- Una carga ya registrada (estado 'registrada', con su factura viva) no vuelve a 'sin_registrar' por una nueva carga del mismo XML.
-- Pasaba cuando la vista tenía la lista de facturas desactualizada: el upsert de la carga pisaba el estado y la factura reaparecía en «Por registrar».
-- Deshacer un registro sigue funcionando: lo hace dejando billing_id en null.
CREATE OR REPLACE FUNCTION sii_cargas_docs_no_revertir() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.estado = 'registrada' AND NEW.estado = 'sin_registrar'
     AND OLD.billing_id IS NOT NULL AND NEW.billing_id IS NOT DISTINCT FROM OLD.billing_id
     AND EXISTS (SELECT 1 FROM billing b WHERE b.id = OLD.billing_id AND b.deleted_at IS NULL) THEN
    NEW.estado := OLD.estado;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS sii_cargas_docs_no_revertir ON sii_cargas_docs;
CREATE TRIGGER sii_cargas_docs_no_revertir BEFORE UPDATE ON sii_cargas_docs
  FOR EACH ROW EXECUTE FUNCTION sii_cargas_docs_no_revertir();
