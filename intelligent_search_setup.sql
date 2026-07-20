-- ==============================================================================
-- IMPLEMENTAÇÃO DE BUSCA INTELIGENTE (FARMAFLOW AI)
-- ==============================================================================
-- Este script configura o banco de dados Supabase/PostgreSQL com:
-- 1. Tabela auxiliar de sinônimos e abreviações farmacêuticas.
-- 2. Extensão pg_trgm e índices GIN para busca textual indexada de ultra-performance.
-- 3. Função de busca RPC (search_products_v2) com rank por peso e tolerância a erros.
--
-- INSTRUÇÕES:
-- Copie todo o conteúdo deste arquivo e execute-o no painel "SQL Editor" do seu Supabase.
-- ==============================================================================

-- 1. Habilitar as extensões necessárias
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS unaccent;

-- Remover índices antigos e função se existirem, para evitar conflitos de inlining
DROP INDEX IF EXISTS public.idx_product_synonyms_term_equiv;
DROP INDEX IF EXISTS public.idx_product_synonyms_term;
DROP FUNCTION IF EXISTS public.farmaflow_immutable_unaccent(TEXT);

-- Função auxiliar IMMUTABLE resiliente para remover acentos e caracteres especiais
CREATE OR REPLACE FUNCTION public.farmaflow_immutable_unaccent(text_val TEXT)
RETURNS TEXT AS $$
BEGIN
  IF text_val IS NULL THEN
    RETURN '';
  END IF;
  
  -- Tenta usar unaccent se a extensão e o dicionário estiverem disponíveis,
  -- senão faz transliteração de caracteres acentuados de forma segura e determinística
  BEGIN
    RETURN public.unaccent(text_val);
  EXCEPTION WHEN OTHERS THEN
    RETURN translate(text_val,
      'áàâãäéèêëíìîïóòôõöúùûüçñÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇÑ',
      'aaaaaeeeeiiiiooooouuuucnAAAAAEEEEIIIIOOOOOUUUUCN'
    );
  END;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- 2. Criar a tabela de sinônimos/abreviações farmacêuticas
CREATE TABLE IF NOT EXISTS public.product_synonyms (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    term TEXT NOT NULL,
    equivalent TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- Índices para garantir rapidez e unicidade
CREATE UNIQUE INDEX IF NOT EXISTS idx_product_synonyms_term_equiv 
ON public.product_synonyms (lower(public.farmaflow_immutable_unaccent(term)), lower(public.farmaflow_immutable_unaccent(equivalent)));

CREATE INDEX IF NOT EXISTS idx_product_synonyms_term 
ON public.product_synonyms (lower(public.farmaflow_immutable_unaccent(term)));

-- 3. Inserir sementes de sinônimos comuns do varejo farmacêutico
INSERT INTO public.product_synonyms (term, equivalent) VALUES
    ('absorvente', 'abs'),
    ('abs', 'absorvente'),
    ('gotas', 'gts'),
    ('gts', 'gotas'),
    ('comprimido', 'cp'),
    ('comprimido', 'cpl'),
    ('comprimido', 'cpr'),
    ('comprimidos', 'cp'),
    ('comprimidos', 'cpl'),
    ('comprimidos', 'cpr'),
    ('cp', 'comprimido'),
    ('cpl', 'comprimido'),
    ('cpr', 'comprimido'),
    ('capsula', 'cap'),
    ('capsulas', 'cap'),
    ('cap', 'capsula'),
    ('miligrama', 'mg'),
    ('miligramas', 'mg'),
    ('mg', 'miligrama'),
    ('paracetamol', 'tylenol'),
    ('tylenol', 'paracetamol'),
    ('dipirona', 'novalgina'),
    ('novalgina', 'dipirona'),
    ('ibuprofeno', 'alivium'),
    ('alivium', 'ibuprofeno'),
    ('gripe', 'cimegripe'),
    ('gripe', 'resfenol'),
    ('antialergico', 'allegra'),
    ('antialergico', 'loratadina')
ON CONFLICT DO NOTHING;

-- 4. Função auxiliar IMMUTABLE para permitir indexação FTS sem erros de mutabilidade
CREATE OR REPLACE FUNCTION public.farmaflow_to_tsvector(text_val TEXT)
RETURNS tsvector AS $$
  SELECT to_tsvector('portuguese'::regconfig, coalesce(text_val, ''));
$$ LANGUAGE sql IMMUTABLE;

-- 4.1 Criar índices GIN de Performance para Busca Rápida (FTS + Trigramas)
-- Índice de busca textual (FTS) com pesos: Nome (A), Categoria (B), Princípio Ativo (B), Descrição (D)
-- O uso de pesos evita que "protetor solar" apareça no topo da busca por "absorvente" devido a "absorção rápida" na descrição.
CREATE INDEX IF NOT EXISTS idx_products_search_fts_weighted ON public.products USING gin (
    (
      setweight(public.farmaflow_to_tsvector(name), 'A') ||
      setweight(public.farmaflow_to_tsvector(category), 'B') ||
      setweight(public.farmaflow_to_tsvector(active_principle), 'B') ||
      setweight(public.farmaflow_to_tsvector(description), 'D')
    )
);

-- Índices trigramados para busca parcial rápida e tolerância a erros de digitação (similarity)
CREATE INDEX IF NOT EXISTS idx_products_name_trgm ON public.products USING gin (name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_products_category_trgm ON public.products USING gin (category gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_products_active_principle_trgm ON public.products USING gin (active_principle gin_trgm_ops);

-- 5. Criar a Função RPC de Busca Inteligente de Produtos (search_products_v2)
CREATE OR REPLACE FUNCTION public.search_products_v2(
  p_tenant_id UUID,
  p_search_term TEXT,
  p_category TEXT DEFAULT 'Todos',
  p_limit INT DEFAULT 100,
  p_offset INT DEFAULT 0
)
RETURNS TABLE (
  id UUID,
  tenant_id UUID,
  name TEXT,
  barcode TEXT,
  price NUMERIC,
  original_price NUMERIC,
  stock INT,
  category TEXT,
  manufacturer TEXT,
  image TEXT,
  description TEXT,
  active_principle TEXT,
  drug_type TEXT,
  presentation TEXT,
  indications TEXT,
  usage TEXT,
  side_effects TEXT,
  contraindications TEXT,
  is_ai_enriched BOOLEAN,
  promotion_type TEXT,
  buy_x INT,
  pay_y INT,
  gallery JSONB,
  video_uri TEXT,
  internal_code TEXT,
  is_featured BOOLEAN,
  discount_qty_threshold INT,
  discount_qty_percentage NUMERIC,
  requires_prescription BOOLEAN,
  grouping_slug TEXT,
  variant_attribute TEXT,
  updated_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ,
  search_rank REAL,
  similarity_score REAL
) 
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_cleaned_term TEXT;
  v_tokens TEXT[];
  v_expanded_tokens TEXT[] := '{}';
  v_token TEXT;
  v_syn RECORD;
  v_tsquery TEXT;
BEGIN
  -- Configura limite rígido de similaridade para evitar buscas lentas / falsos positivos
  PERFORM set_config('pg_trgm.similarity_threshold', '0.4', true);

  -- Limpar e normalizar termo buscado
  v_cleaned_term := lower(public.farmaflow_immutable_unaccent(trim(p_search_term)));
  
  -- Retornar todos os produtos se a busca estiver vazia
  IF v_cleaned_term IS NULL OR v_cleaned_term = '' THEN
    RETURN QUERY
    SELECT 
      p.id, p.tenant_id, p.name, p.barcode, p.price, p.original_price, p.stock, p.category, 
      p.manufacturer, p.image, p.description, p.active_principle, p.drug_type, p.presentation, 
      p.indications, p.usage, p.side_effects, p.contraindications, p.is_ai_enriched, 
      p.promotion_type, p.buy_x, p.pay_y, p.gallery, p.video_uri, p.internal_code, 
      p.is_featured, p.discount_qty_threshold, p.discount_qty_percentage, p.requires_prescription, 
      p.grouping_slug, p.variant_attribute, p.updated_at, p.created_at,
      0.0::REAL AS search_rank,
      0.0::REAL AS similarity_score
    FROM public.products p
    WHERE p.tenant_id = p_tenant_id
      AND (p_category = 'Todos' OR p.category = p_category)
    ORDER BY p.is_featured DESC, p.name ASC
    LIMIT p_limit OFFSET p_offset;
    RETURN;
  END IF;

  -- Tokenizar termo buscado
  v_tokens := regexp_split_to_array(v_cleaned_term, '\s+');
  
  -- Resolver sinônimos e abreviações
  FOREACH v_token IN ARRAY v_tokens LOOP
    v_expanded_tokens := array_append(v_expanded_tokens, v_token);
    
    FOR v_syn IN 
      SELECT equivalent 
      FROM public.product_synonyms 
      WHERE lower(public.farmaflow_immutable_unaccent(term)) = v_token
    LOOP
      v_expanded_tokens := array_append(v_expanded_tokens, lower(public.farmaflow_immutable_unaccent(v_syn.equivalent)));
    END LOOP;
  END LOOP;

  -- Unificar e remover duplicatas nos tokens expandidos
  SELECT array_agg(DISTINCT x) INTO v_expanded_tokens FROM unnest(v_expanded_tokens) x;

  -- Formatar tsquery com OR para sinônimos e AND para tokens diferentes
  v_tsquery := (
    SELECT string_agg(quote_ident(tok) || ':*', ' | ') 
    FROM unnest(v_expanded_tokens) tok
  );

  -- Executar busca com rankeamento inteligente por relevância (FTS rank + Similarity)
  RETURN QUERY
  SELECT 
    p.id, p.tenant_id, p.name, p.barcode, p.price, p.original_price, p.stock, p.category, 
    p.manufacturer, p.image, p.description, p.active_principle, p.drug_type, p.presentation, 
    p.indications, p.usage, p.side_effects, p.contraindications, p.is_ai_enriched, 
    p.promotion_type, p.buy_x, p.pay_y, p.gallery, p.video_uri, p.internal_code, 
    p.is_featured, p.discount_qty_threshold, p.discount_qty_percentage, p.requires_prescription, 
    p.grouping_slug, p.variant_attribute, p.updated_at, p.created_at,
    -- Rank FTS de Relevância com Pesos específicos
    ts_rank_cd(
      setweight(public.farmaflow_to_tsvector(p.name), 'A') ||
      setweight(public.farmaflow_to_tsvector(p.category), 'B') ||
      setweight(public.farmaflow_to_tsvector(p.active_principle), 'B') ||
      setweight(public.farmaflow_to_tsvector(p.description), 'D'),
      to_tsquery('portuguese', v_tsquery)
    )::REAL AS search_rank,
    -- Similaridade trigramada no nome do produto
    similarity(p.name, p_search_term)::REAL AS similarity_score
  FROM public.products p
  WHERE p.tenant_id = p_tenant_id
    AND (p_category = 'Todos' OR p.category = p_category)
    AND (
      -- Condição 1: Correspondência de busca textual por pesos (FTS)
      (
        setweight(public.farmaflow_to_tsvector(p.name), 'A') ||
        setweight(public.farmaflow_to_tsvector(p.category), 'B') ||
        setweight(public.farmaflow_to_tsvector(p.active_principle), 'B') ||
        setweight(public.farmaflow_to_tsvector(p.description), 'D')
      ) @@ to_tsquery('portuguese', v_tsquery)
      OR
      -- Condição 2: Tolerância a pequenos erros de digitação (Trigrama)
      similarity(p.name, p_search_term) >= 0.4
      OR
      -- Condição 3: Busca substring clássica como salvaguarda
      p.name ILIKE '%' || v_cleaned_term || '%'
    )
  ORDER BY 
    -- 1. Exibir primeiro as correspondências exatas de título ou sinônimos diretos
    (CASE WHEN p.name ILIKE '%' || v_cleaned_term || '%' THEN 1 ELSE 0 END) DESC,
    -- 2. Rank FTS (Relevância)
    ts_rank_cd(
      setweight(public.farmaflow_to_tsvector(p.name), 'A') ||
      setweight(public.farmaflow_to_tsvector(p.category), 'B') ||
      setweight(public.farmaflow_to_tsvector(p.active_principle), 'B') ||
      setweight(public.farmaflow_to_tsvector(p.description), 'D'),
      to_tsquery('portuguese', v_tsquery)
    ) DESC,
    -- 3. Similaridade trigramada (erros leves)
    similarity(p.name, p_search_term) DESC,
    -- 4. Destaque (is_featured) como fator de empate para boost de conversão
    p.is_featured DESC,
    p.name ASC
  LIMIT p_limit OFFSET p_offset;
END;
$$;

-- Garantir privilégios para que possa ser invocada via API REST/RPC
GRANT EXECUTE ON FUNCTION public.search_products_v2 TO anon, authenticated, service_role;
