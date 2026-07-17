ALTER TABLE public.products ADD CONSTRAINT unique_product_barcode_per_tenant UNIQUE (tenant_id, barcode);
