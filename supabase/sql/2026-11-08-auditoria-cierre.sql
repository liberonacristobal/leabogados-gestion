-- Cómo se cerró cada hallazgo del auditor: 'decidido' (una persona lo dejó resuelto con el botón de su sección) o 'corregido' (el dato cambió y el detector dejó de verlo).
alter table public.auditoria_hallazgos add column if not exists cierre text, add column if not exists motivo text, add column if not exists resuelto_por text;
notify pgrst, 'reload schema';
