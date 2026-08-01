-- Complementa a infraestrutura de impressao com indices para todas as chaves
-- estrangeiras consultadas e remove a sobreposicao de politicas SELECT.

create index if not exists idx_replacement_labels_replacement_piece
  on public.replacement_labels (replacement_piece_id)
  where replacement_piece_id is not null;

create index if not exists idx_replacement_labels_original_piece
  on public.replacement_labels (original_piece_id)
  where original_piece_id is not null;

create index if not exists idx_replacement_labels_template
  on public.replacement_labels (template_id)
  where template_id is not null;

create index if not exists idx_replacement_label_prints_replacement_piece
  on public.replacement_label_prints (replacement_piece_id)
  where replacement_piece_id is not null;

drop policy if exists label_templates_manage on public.label_templates;

drop policy if exists label_templates_insert on public.label_templates;
create policy label_templates_insert on public.label_templates
  for insert to authenticated
  with check (
    public.get_my_role() in ('admin', 'manager')
    or (select public.has_permission('manage_quality'))
  );

drop policy if exists label_templates_update on public.label_templates;
create policy label_templates_update on public.label_templates
  for update to authenticated
  using (
    public.get_my_role() in ('admin', 'manager')
    or (select public.has_permission('manage_quality'))
  )
  with check (
    public.get_my_role() in ('admin', 'manager')
    or (select public.has_permission('manage_quality'))
  );

drop policy if exists label_templates_delete on public.label_templates;
create policy label_templates_delete on public.label_templates
  for delete to authenticated
  using (
    public.get_my_role() in ('admin', 'manager')
    or (select public.has_permission('manage_quality'))
  );
