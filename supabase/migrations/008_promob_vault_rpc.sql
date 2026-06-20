-- ============================================================
-- AC.Prod — MES Leo Madeiras
-- Migration 008: Funções RPC para interação com o Supabase Vault
-- Permite armazenar e obter tokens da API Promob de forma criptografada
-- ============================================================

CREATE EXTENSION IF NOT EXISTS supabase_vault WITH SCHEMA vault;

CREATE OR REPLACE FUNCTION store_promob_token(integration_id uuid, token_text text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  secret_id uuid;
  existing_ref text;
BEGIN
  -- Verificar se já existe uma referência
  SELECT token_reference INTO existing_ref FROM promob_integrations WHERE id = integration_id;
  
  IF existing_ref IS NOT NULL AND existing_ref <> '' THEN
    secret_id := existing_ref::uuid;
    -- Atualizar o segredo existente
    PERFORM vault.update_secret(secret_id, new_secret := token_text);
  ELSE
    -- Criar novo segredo no Vault
    secret_id := vault.create_secret(
      new_secret := token_text,
      new_name := 'promob_token_' || integration_id::text,
      new_description := 'Token da API Promob para integracao ' || integration_id::text
    );
    -- Atualizar a integração com a referência do segredo
    UPDATE promob_integrations SET token_reference = secret_id::text WHERE id = integration_id;
  END IF;
  
  RETURN secret_id;
END;
$$;

CREATE OR REPLACE FUNCTION get_promob_token(integration_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  secret_id uuid;
  decrypted text;
BEGIN
  SELECT token_reference::uuid INTO secret_id FROM promob_integrations WHERE id = integration_id;
  
  IF secret_id IS NULL THEN
    RETURN NULL;
  END IF;
  
  SELECT decrypted_secret INTO decrypted FROM vault.decrypted_secrets WHERE id = secret_id;
  RETURN decrypted;
END;
$$;

-- Restringe o privilégio de execução apenas ao service_role para evitar acesso pelo frontend direto
REVOKE EXECUTE ON FUNCTION store_promob_token(uuid, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION get_promob_token(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION store_promob_token(uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION get_promob_token(uuid) TO service_role;
