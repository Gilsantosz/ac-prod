-- Função segura para excluir usuário do Auth e Profiles de forma integrada
CREATE OR REPLACE FUNCTION public.delete_user_from_auth(target_user_id UUID)
RETURNS VOID AS $$
DECLARE
  caller_role TEXT;
BEGIN
  -- 1. Obter o papel (role) do usuário logado que está chamando a função
  SELECT role INTO caller_role FROM public.profiles WHERE id = auth.uid();

  -- 2. Permitir apenas se o chamador for 'admin'
  IF caller_role <> 'admin' THEN
    RAISE EXCEPTION 'Apenas administradores podem excluir usuários do sistema.';
  END IF;

  -- 3. Excluir da tabela auth.users. Devido a chave estrangeira ON DELETE CASCADE,
  -- isso removerá automaticamente o perfil na tabela public.profiles.
  DELETE FROM auth.users WHERE id = target_user_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
