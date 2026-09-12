-- FarmaFlow Migration: Retrocompatible banner fields for promotions
-- Executar no Editor SQL do Supabase caso queira adicionar as colunas na tabela diretamente
ALTER TABLE IF EXISTS promotions
ADD COLUMN IF NOT EXISTS show_banner_card BOOLEAN DEFAULT NULL,
ADD COLUMN IF NOT EXISTS banner_headline TEXT DEFAULT NULL;
