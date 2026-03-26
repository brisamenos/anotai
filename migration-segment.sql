-- ═══════════════════════════════════════════════════════
-- MIGRATION: Adicionar suporte a multi-segmento
-- Execute uma vez no banco de dados (SQLite)
-- ═══════════════════════════════════════════════════════

-- 1. Adiciona coluna segment na tabela de tenants
--    DEFAULT 'restaurante' garante que todos os tenants existentes
--    continuem funcionando normalmente, sem nenhuma quebra.
ALTER TABLE tenants ADD COLUMN segment TEXT NOT NULL DEFAULT 'restaurante';

-- 2. (Opcional) Verificar resultado
-- SELECT id, nome, slug, segment FROM tenants;
