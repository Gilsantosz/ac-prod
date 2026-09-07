-- Sincronização inicial, somente de identidades verificáveis do MES existente.
-- Não cria produção, amostras de ciclo, tempos padrão ou agrupamentos de famílias.
-- Prévia conferida em produção: 2.157 peças com OP e serial válidos,
-- 2.155 códigos de produto distintos. Códigos de peças personalizadas continuam
-- distintos; não assumimos que nome, dimensão ou material tornam ciclos iguais.

-- Usa o ID do primeiro item por SKU como identidade inicial; se o SKU já
-- existir no cadastro novo, preserva o registro e seu padrão de engenharia.
INSERT INTO public.produtos (id, sku, descricao, tempo_ciclo_padrao)
SELECT DISTINCT ON (btrim(item.product_code))
       item.id, btrim(item.product_code),
       COALESCE(NULLIF(btrim(item.product_name), ''), btrim(item.product_code)),
       NULL
FROM public.production_lot_items item
WHERE NULLIF(btrim(item.product_code), '') IS NOT NULL
ORDER BY btrim(item.product_code), item.id
ON CONFLICT (sku) DO NOTHING;

-- ID e serial continuam sendo os mesmos da peça física. Uma peça só entra se
-- produto e ordem puderem ser associados por chaves existentes e serial válido.
-- Conflito de serial com outro ID é um erro de identidade, não é ocultado.
INSERT INTO public.rastreabilidade_pecas (
    id, codigo_serial_rfid, produto_id, ordem_producao_id, status
)
SELECT piece.id, piece.traceability_code, product.id,
       piece.production_order_id, piece.status
FROM public.production_pieces piece
JOIN public.production_lot_items item ON item.id = piece.legacy_production_lot_item_id
JOIN public.produtos product ON product.sku = btrim(item.product_code)
JOIN public.production_orders production_order ON production_order.id = piece.production_order_id
WHERE NULLIF(btrim(piece.traceability_code), '') IS NOT NULL
  AND length(piece.traceability_code) <= 255
  AND NULLIF(btrim(piece.status), '') IS NOT NULL
ON CONFLICT (id) DO NOTHING;
