-- ═══════════════════════════════════════════════════════
-- MIGRATION: Taxa de serviço do garçom
-- Execute uma vez no banco de dados (Supabase/PostgreSQL)
-- ═══════════════════════════════════════════════════════

-- Adiciona coluna taxa_servico_pct na store_config
-- DEFAULT 0 = desativado para todos os tenants existentes
ALTER TABLE store_config ADD COLUMN IF NOT EXISTS taxa_servico_pct NUMERIC(5,2) NOT NULL DEFAULT 0;

-- (Opcional) Verificar resultado
-- SELECT tenant_id, taxa_servico_pct FROM store_config;
