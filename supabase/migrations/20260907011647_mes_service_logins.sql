-- Na produção, as senhas SCRAM foram provisionadas via canal privado.
-- O histórico público não inclui senhas nem seus verificadores criptográficos.
-- Em ambiente novo, atribuir os segredos de serviço pela rotina de implantação.
ALTER ROLE mes_api LOGIN;
ALTER ROLE mes_leitura LOGIN;
