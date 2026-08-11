-- Permite múltiplas instâncias de WhatsApp por tenant (store_id)
-- Removendo a restrição de que cada loja só pode ter uma instância

ALTER TABLE public.whatsapp_instances DROP CONSTRAINT IF EXISTS whatsapp_instances_store_id_key;
ALTER TABLE public.whatsapp_instances ADD CONSTRAINT whatsapp_instances_instance_name_key UNIQUE (instance_name);

-- Opcional: Adiciona campo inbox_id para facilitar o vínculo (se desejar)
-- ALTER TABLE public.whatsapp_instances ADD COLUMN IF NOT EXISTS inbox_id UUID REFERENCES public.inboxes(id) ON DELETE SET NULL;
