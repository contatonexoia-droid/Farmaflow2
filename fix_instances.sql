ALTER TABLE public.whatsapp_instances DROP CONSTRAINT IF EXISTS whatsapp_instances_store_id_key;
ALTER TABLE public.whatsapp_instances ADD CONSTRAINT whatsapp_instances_instance_name_key UNIQUE (instance_name);
