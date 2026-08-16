-- Migração: Alterar a estrutura de armazenamento de preços de promoções
-- Altera a coluna pay_y usada no "Combo Fixo" para aceitar precisão decimal em Reais.
-- Aplicado na tabela promotions e referenciado na tabela products (caso haja legado).

BEGIN;

-- Se o banco armazenava falhas e strings no formato antigo, forçamos a limpeza ou casting via numérico.
ALTER TABLE promotions 
  ALTER COLUMN combo_discount_percentage TYPE NUMERIC(10, 2) USING combo_discount_percentage::NUMERIC(10, 2),
  ALTER COLUMN pay_y TYPE NUMERIC(10, 2) USING pay_y::NUMERIC(10, 2);

ALTER TABLE products 
  ALTER COLUMN pay_y TYPE NUMERIC(10, 2) USING pay_y::NUMERIC(10, 2);

COMMIT;
