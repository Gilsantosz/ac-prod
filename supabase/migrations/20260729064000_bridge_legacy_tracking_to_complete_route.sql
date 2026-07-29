-- Mantém a RPC histórica compatível com o frontend já publicado, mas usa a
-- rota canônica completa como fonte de verdade para cada lote selecionado.
-- Isso inclui Furação, Separação e Embalagem sem duplicar fatos produtivos.

begin;

do $migration$
declare
  current_definition text;
begin
  if to_regprocedure('public.get_general_lot_tracking_base(uuid, integer)') is null then
    select pg_get_functiondef(
      'public.get_general_lot_tracking(uuid, integer)'::regprocedure
    )
      into current_definition;

    current_definition := replace(
      current_definition,
      'FUNCTION public.get_general_lot_tracking(',
      'FUNCTION public.get_general_lot_tracking_base('
    );

    execute current_definition;
  end if;
end
$migration$;

create or replace function public.get_general_lot_tracking(
  p_batch_id uuid default null,
  p_limit integer default 25
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $function$
declare
  payload jsonb;
  route_progress jsonb;
  general_lots jsonb := '[]'::jsonb;
  client_lots jsonb;
  general_lot jsonb;
  client_lot jsonb;
  lot_stages jsonb;
  traceable_required integer;
  traceable_completed integer;
  route_complete boolean;
begin
  payload := public.get_general_lot_tracking_base(p_batch_id, p_limit);

  -- A listagem geral não traz lotes de clientes e deve continuar leve. A rota
  -- completa é anexada apenas quando um lote geral é aberto.
  if p_batch_id is null then
    return payload;
  end if;

  for general_lot in
    select item.value
    from jsonb_array_elements(
      coalesce(payload->'general_lots', '[]'::jsonb)
    ) item(value)
  loop
    route_progress := public.get_lot_route_stage_progress(
      (general_lot->>'batch_id')::uuid
    );
    client_lots := '[]'::jsonb;

    for client_lot in
      select item.value
      from jsonb_array_elements(
        coalesce(general_lot->'client_lots', '[]'::jsonb)
      ) item(value)
    loop
      lot_stages := coalesce(
        route_progress->'lot_stages'->(client_lot->>'lot_id'),
        '[]'::jsonb
      );

      if jsonb_array_length(lot_stages) > 0 then
        select
          coalesce(sum(
            coalesce((stage.value->>'required_pieces')::integer, 0)
          ) filter (
            where coalesce(
              (stage.value->>'traceable_collection_required')::boolean,
              true
            )
          ), 0)::integer,
          coalesce(sum(
            least(
              coalesce((stage.value->>'required_pieces')::integer, 0),
              coalesce(
                (stage.value->>'effective_completed_pieces')::integer,
                (stage.value->>'completed_pieces')::integer,
                0
              )
            )
          ) filter (
            where coalesce(
              (stage.value->>'traceable_collection_required')::boolean,
              true
            )
          ), 0)::integer,
          coalesce(bool_and(
            case
              when coalesce(
                (stage.value->>'traceable_collection_required')::boolean,
                true
              )
              and coalesce((stage.value->>'required_pieces')::integer, 0) > 0
              then coalesce(
                (stage.value->>'effective_completed_pieces')::integer,
                (stage.value->>'completed_pieces')::integer,
                0
              ) >= coalesce((stage.value->>'required_pieces')::integer, 0)
              else true
            end
          ), false)
          into traceable_required, traceable_completed, route_complete
        from jsonb_array_elements(lot_stages) stage(value);

        client_lot := client_lot || jsonb_build_object(
          'stages', lot_stages,
          'total_operations', traceable_required,
          'completed_operations', traceable_completed,
          'progress_percent', case
            when traceable_required > 0
              then round(100.0 * traceable_completed / traceable_required, 2)
            else 100.0
          end,
          'ready_for_separation', route_complete
        );
      end if;

      client_lots := client_lots || jsonb_build_array(client_lot);
    end loop;

    select
      coalesce(sum(
        coalesce((stage.value->>'required_pieces')::integer, 0)
      ) filter (
        where coalesce(
          (stage.value->>'traceable_collection_required')::boolean,
          true
        )
      ), 0)::integer,
      coalesce(sum(
        least(
          coalesce((stage.value->>'required_pieces')::integer, 0),
          coalesce(
            (stage.value->>'effective_completed_pieces')::integer,
            (stage.value->>'completed_pieces')::integer,
            0
          )
        )
      ) filter (
        where coalesce(
          (stage.value->>'traceable_collection_required')::boolean,
          true
        )
      ), 0)::integer,
      coalesce(bool_and(
        case
          when coalesce(
            (stage.value->>'traceable_collection_required')::boolean,
            true
          )
          and coalesce((stage.value->>'required_pieces')::integer, 0) > 0
          then coalesce(
            (stage.value->>'effective_completed_pieces')::integer,
            (stage.value->>'completed_pieces')::integer,
            0
          ) >= coalesce((stage.value->>'required_pieces')::integer, 0)
          else true
        end
      ), false)
      into traceable_required, traceable_completed, route_complete
    from jsonb_array_elements(
      coalesce(route_progress->'batch_stages', '[]'::jsonb)
    ) stage(value);

    general_lot := general_lot || jsonb_build_object(
      'stages', coalesce(route_progress->'batch_stages', '[]'::jsonb),
      'client_lots', client_lots,
      'total_operations', traceable_required,
      'completed_operations', traceable_completed,
      'progress_percent', case
        when traceable_required > 0
          then round(100.0 * traceable_completed / traceable_required, 2)
        else 100.0
      end,
      'ready_for_separation', route_complete
    );

    general_lots := general_lots || jsonb_build_array(general_lot);
  end loop;

  return jsonb_set(payload, '{general_lots}', general_lots, true);
end;
$function$;

revoke all on function public.get_general_lot_tracking_base(uuid, integer)
  from public, anon;
grant execute on function public.get_general_lot_tracking_base(uuid, integer)
  to authenticated;

revoke all on function public.get_general_lot_tracking(uuid, integer)
  from public, anon;
grant execute on function public.get_general_lot_tracking(uuid, integer)
  to authenticated;

comment on function public.get_general_lot_tracking(uuid, integer) is
  'Entrega a visão histórica de acompanhamento enriquecida pela rota canônica completa de cada lote.';

notify pgrst, 'reload schema';

commit;
