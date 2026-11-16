-- Reclamo del envío: quien lo reserva (token nuevo) es el único que envía; vence a los 5 minutos si el proceso muere.
ALTER TABLE envio ADD COLUMN reclamado_en timestamptz NULL;
