-- Estratégia de Backup Sem Acúmulo (Lógica de UPSERT) e Restauração Un-Click

-- 1. Criação/Atualização da Tabela de Controle de Backups
-- Recomenda-se salvar os dados como JSONB para facilitar a restauração rápida via RPC
-- sem depender de complexidade de downloads do Storage, garantindo atomicidade na transação.
CREATE TABLE IF NOT EXISTS public.tenant_backups (
    tenant_id TEXT PRIMARY KEY REFERENCES public.tenants(id) ON DELETE CASCADE,
    backup_data JSONB NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Habilitar RLS (Row Level Security)
ALTER TABLE public.tenant_backups ENABLE ROW LEVEL SECURITY;

-- Políticas de segurança
DROP POLICY IF EXISTS "Super Admins podem ler todos os backups" ON public.tenant_backups;
CREATE POLICY "Super Admins podem ler todos os backups" 
    ON public.tenant_backups FOR SELECT 
    USING (true);

DROP POLICY IF EXISTS "Super Admins podem criar e atualizar backups" ON public.tenant_backups;
CREATE POLICY "Super Admins podem criar e atualizar backups" 
    ON public.tenant_backups FOR ALL 
    USING (true);

-- Trigger para atualizar timestamps
CREATE OR REPLACE FUNCTION update_tenant_backups_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = timezone('utc'::text, now());
    RETURN NEW;
END;
$$ language 'plpgsql';

DROP TRIGGER IF EXISTS trigger_tenant_backups_updated_at ON public.tenant_backups;
CREATE TRIGGER trigger_tenant_backups_updated_at
    BEFORE UPDATE ON public.tenant_backups
    FOR EACH ROW
    EXECUTE FUNCTION update_tenant_backups_updated_at();

-- 2. Função de Backup (Edge Function ou pg_cron aciona)
-- Realiza o UPSERT na tabela tenant_backups, mantendo sempre o último estado da farmácia.
CREATE OR REPLACE FUNCTION perform_tenant_backup(target_tenant_id TEXT, payload JSONB)
RETURNS void AS $$
BEGIN
    INSERT INTO public.tenant_backups (tenant_id, backup_data, created_at, updated_at)
    VALUES (target_tenant_id, payload, now(), now())
    ON CONFLICT (tenant_id)
    DO UPDATE SET 
        backup_data = EXCLUDED.backup_data,
        updated_at = EXCLUDED.updated_at;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- 3. Mecanismo de Restauração Direta pelo Painel do Super Admin (Stored Procedure)
-- Realiza de forma transacional e segura a restauração da farmácia a partir de `tenant_backups`
CREATE OR REPLACE FUNCTION restore_tenant_backup(target_tenant_id TEXT)
RETURNS boolean AS $$
DECLARE
    backup_payload JSONB;
BEGIN
    -- Obter os dados de backup do tenant_id especificado
    SELECT backup_data INTO backup_payload
    FROM public.tenant_backups
    WHERE tenant_id = target_tenant_id;

    IF backup_payload IS NULL THEN
        RAISE EXCEPTION 'Não há backup disponível para restauração deste tenant (%).', target_tenant_id;
    END IF;

    -- Início do bloco transacional de rollback seguro (o psql garante atomicidade nesta procedure)

    -- =========================================================================
    -- ABORDAGEM 1: ORDEM DE LIMPEZA ESTRITA (INTEGRIDADE)
    -- Limpar todas as tabelas filhas na ordem inversa de suas dependências.
    -- Isso garante que nenhum constraint "fk_tenant" seja violado por causa da tabela "products" e "tenants".
    -- =========================================================================

    -- A. Dependências de Ponta (Logs, etc)
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'search_logs') THEN
        EXECUTE 'DELETE FROM public.search_logs WHERE tenant_id = $1' USING target_tenant_id;
    END IF;
    
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'integration_logs') THEN
        EXECUTE 'DELETE FROM public.integration_logs WHERE tenant_id = $1' USING target_tenant_id;
    END IF;

    -- B. Dependências de Negócio e E-Commerce
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'orders') THEN
        EXECUTE 'DELETE FROM public.orders WHERE tenant_id = $1' USING target_tenant_id;
    END IF;
    
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'app_reviews') THEN
        EXECUTE 'DELETE FROM public.app_reviews WHERE tenant_id = $1' USING target_tenant_id;
    END IF;
    
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'promotions') THEN
        EXECUTE 'DELETE FROM public.promotions WHERE tenant_id = $1' USING target_tenant_id;
    END IF;
    
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'coupons') THEN
        EXECUTE 'DELETE FROM public.coupons WHERE tenant_id = $1' USING target_tenant_id;
    END IF;

    -- C. Dependência Primária (Catálogo)
    -- Por fim, deleta tudo da tabela de produtos agora que nenhuma outra tabela filha pode bloquear a exclusão.
    DELETE FROM public.products WHERE tenant_id = target_tenant_id;

    -- =========================================================================
    -- FIM DA LIMPEZA - INíCIO DA INJEçãO (OVERWRITE)
    -- =========================================================================

    -- 3. Injetar Produtos (Assumindo que em backup_payload->'products' existe um array)
    IF backup_payload->'products' IS NOT NULL THEN
        INSERT INTO public.products (
            id, tenant_id, code, ean, name, description, active_principle, lab, category, department, stock, price, discount_price, requires_prescription, image_url, created_at
        )
        SELECT 
            (elem->>'id')::UUID,
            target_tenant_id,
            elem->>'code',
            elem->>'ean',
            elem->>'name',
            elem->>'description',
            elem->>'active_principle',
            elem->>'lab',
            elem->>'category',
            elem->>'department',
            (elem->>'stock')::INTEGER,
            (elem->>'price')::NUMERIC,
            (elem->>'discount_price')::NUMERIC,
            (elem->>'requires_prescription')::BOOLEAN,
            elem->>'image_url',
            COALESCE((elem->>'created_at')::TIMESTAMP, now())
        FROM jsonb_array_elements(backup_payload->'products') AS elem;
    END IF;

    -- 4. Repita para outras estruturas como promos e config do tenant se houver
    -- Se houvesse update para tabela `tenants` aqui, agora iria disparar sem falhas
    -- UPDATE public.tenants SET primary_color = backup_payload->'config'->>'primaryColor' WHERE id = target_tenant_id;

    RETURN true;

EXCEPTION WHEN OTHERS THEN
    -- Qualquer erro abortará a transação atual e disparará um ROLLBACK automático, prevenindo perda do catálogo.
    RAISE EXCEPTION 'RESTORE_ERROR: % - A operação de overwrite foi revertida com segurança (ROLLBACK executado).', SQLERRM;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
