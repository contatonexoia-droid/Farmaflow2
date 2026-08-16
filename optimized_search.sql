-- Função otimizada para busca fuzzy de produtos (Case-insensitive e multi-termos)
-- Pode ser usada no Supabase via RPC (Remote Procedure Call)

CREATE OR REPLACE FUNCTION search_products(search_query text, tenant_uuid uuid)
RETURNS SETOF products AS $$
DECLARE
    search_tokens text[];
    token text;
    query_pattern text := '';
BEGIN
    -- Converte a busca em um array de palavras, removendo espaços vazios
    search_tokens := string_to_array(trim(search_query), ' ');
    
    -- Se não houver termos, retorna todos daquele tenant que estão com estoque ativo
    IF array_length(search_tokens, 1) IS NULL THEN
        RETURN QUERY SELECT * FROM products WHERE tenant_id = tenant_uuid AND stock > 0;
        RETURN;
    END IF;

    -- Constrói o padrão para a cláusula ILIKE
    -- Exemplo: 'Absorvente intimus' vira '%Absorvente%intimus%' (simplificado)
    -- Mas a melhor forma é exigir que TODOS os tokens existam em um dos campos de busca
    -- Para isso, usaremos um AND para cada token
    
    RETURN QUERY 
    SELECT p.* 
    FROM products p
    WHERE p.tenant_id = tenant_uuid 
      AND p.stock > 0
      AND (
        -- Verifica se TODOS os tokens aparecem no nome, categoria, principio ativo, etc.
        -- Utiliza a sintaxe do PostgreSQL para garantir correspondência completa
        EXISTS (
            SELECT 1 
            FROM unnest(search_tokens) AS t
            HAVING count(*) = sum(
                CASE WHEN (
                    p.name ILIKE '%' || t || '%' OR 
                    COALESCE(p.active_principle, '') ILIKE '%' || t || '%' OR 
                    COALESCE(p.category, '') ILIKE '%' || t || '%' OR
                    COALESCE(p.manufacturer, '') ILIKE '%' || t || '%' OR
                    COALESCE(p.indications, '') ILIKE '%' || t || '%'
                ) THEN 1 ELSE 0 END
            )
        )
      )
    ORDER BY 
        -- Prioriza os produtos onde o nome inicia com o primeiro termo da busca
        CASE WHEN p.name ILIKE search_tokens[1] || '%' THEN 1 ELSE 2 END,
        -- Em seguida, prioriza os que têm a palavra exata no nome
        CASE WHEN p.name ILIKE '%' || search_query || '%' THEN 1 ELSE 2 END,
        p.name ASC;
END;
$$ LANGUAGE plpgsql;
