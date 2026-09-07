# Inventário runtime de funções SECURITY DEFINER

Captura somente leitura do projeto `uozuzdfvnufsjsonswag`, em 2026-09-04T16:28Z.
Cada linha representa um overload e usa o hash SHA-256 do corpo efetivo. Nenhum
corpo, payload, segredo, token ou dado pessoal é emitido neste manifesto.

Este arquivo é uma **triagem**, não aprovação de segurança. Os sinais são buscas
estáticas no corpo e não provam autorização correta. `REVIEW_REQUIRED` significa
que justificativa de `SECURITY DEFINER`, checagem Auth/role/setor, grants mínimos
e testes positivos/negativos ainda precisam ser concluídos antes do gate F0.

## Resumo

| Métrica | Valor |
|---|---:|
| Overloads SECURITY DEFINER | 222 |
| Schema public | 208 |
| Schema private | 14 |
| EXECUTE efetivo anon | 5 |
| EXECUTE efetivo authenticated | 108 |
| search_path vazio | 2 |
| Prioridade P0 | 126 |
| Prioridade P1 | 43 |
| Prioridade P2 | 53 |

## Legenda

- Grants são efetivos, portanto incluem acesso herdado de `PUBLIC`.
- `Auth` marca referência estática a `auth.uid()` ou claims JWT.
- `Role` marca helpers por nome; não prova que são corretos ou fail-closed.
- `Sector/site` marca apenas a presença textual dessas dimensões.
- Prioridade é triagem: P0 cobre superfície crítica/nome sensível ou anon; P1,
  cliente autenticado; P2, demais funções internas.

## Overloads

| Pri | Schema | Assinatura | Owner | PUBLIC | anon | authd | service | path | Auth | Role | Sector/site | Definição SHA-256 | Estado |
|---|---|---|---|---:|---:|---:|---:|---|---:|---:|---:|---|---|
| P0 | private | `private.assert_collection_read_scope(uuid,text)` | `postgres` | no | no | no | no | NONEMPTY | yes | yes | no | `a72b7f07d16f642f4aae2779923e8cc32d4f0e70d9fd443ed741af0e1e9e32f2` | REVIEW_REQUIRED |
| P0 | private | `private.enqueue_collection_projection_correction_v3()` | `postgres` | no | no | no | no | NONEMPTY | no | no | no | `ca0d3b0ff30e985716fbef6dbec22234f986009e4e781545ee95ba5365d81591` | REVIEW_REQUIRED |
| P0 | private | `private.enqueue_collection_projection_v3(text,uuid,uuid,uuid,uuid,uuid,uuid,text,text,text,integer,jsonb)` | `postgres` | no | no | no | no | NONEMPTY | no | no | no | `dda29de207c44ed14a17b6deffe070e453e8c0bb3ba25bb285c286eb2a1fb2ad` | REVIEW_REQUIRED |
| P0 | private | `private.mark_collection_projection_v3(uuid,text,jsonb)` | `postgres` | no | no | no | no | NONEMPTY | no | no | no | `aee4ffcd3a0cf2fbd4ac994dbefdae12918ce31c60dd82770fb933e63b77e751` | REVIEW_REQUIRED |
| P0 | private | `private.notify_collection_inbox_worker()` | `postgres` | no | no | no | no | NONEMPTY | no | no | no | `4d21801ab1cdeb5120c8f860233da17ab67e04fb64eff2511452190007684e39` | REVIEW_REQUIRED |
| P0 | private | `private.notify_collection_v3_decision_worker()` | `postgres` | no | no | no | no | NONEMPTY | no | no | no | `3e3dcdff0638a9691d5c059e412f8d6d384a093e69593d0aaa576cad5ff22af2` | REVIEW_REQUIRED |
| P0 | private | `private.notify_collection_v3_projection_worker()` | `postgres` | no | no | no | no | NONEMPTY | no | no | no | `5b4207c7f1bb4cca72d42eff101457f0fe68896645477f016f1ac34108d68319` | REVIEW_REQUIRED |
| P0 | private | `private.process_collection_batch_v3(text,jsonb)` | `postgres` | no | no | no | yes | NONEMPTY | no | no | no | `f58cf659b1d1bf4daeb6c1575ff7aa1ced4c2a3e0d39224399d48683d2e50fd9` | REVIEW_REQUIRED |
| P0 | private | `private.process_collection_projection_batch_v3(text,jsonb)` | `postgres` | no | no | no | yes | NONEMPTY | no | no | no | `6c903b17208a76749a3633c11fb6d2efec00fa111a447ddc9861215a46b3cf95` | REVIEW_REQUIRED |
| P0 | private | `private.restore_collection_v3_projection_triggers()` | `postgres` | no | no | no | no | NONEMPTY | no | no | no | `c173590ea98ae5fcfa5c47b2460d271f0d09a1d3d91b9a91e14feb4f794daa5c` | REVIEW_REQUIRED |
| P0 | private | `private.try_acquire_collection_worker_lease_v3(text,text,integer)` | `postgres` | no | no | no | no | NONEMPTY | no | no | no | `2fc9128166cb39e8e4fa055853f87d28215ff44b76d1185ff3f1735d149fb950` | REVIEW_REQUIRED |
| P0 | private | `private.validate_replacement_operator_session_v2(text,text,boolean)` | `postgres` | no | no | no | no | NONEMPTY | yes | no | no | `fa91772910bbfe97ca9c28ea6c19ab62928d81f54674dda9156f249620de3645` | REVIEW_REQUIRED |
| P0 | private | `private.wake_collection_inbox_worker(text,integer)` | `postgres` | no | no | no | yes | NONEMPTY | no | no | no | `d34e033b3fa773a662f8951bed1e4b0ed8c2ebad63d095dffa8536169f8ad556` | REVIEW_REQUIRED |
| P0 | private | `private.wake_collection_v3_worker(text,text,integer)` | `postgres` | no | no | no | yes | NONEMPTY | no | no | no | `dec9e4544ec64715f2f1f47588d0a2bc0a0142e035aec217c194def58a75b1de` | REVIEW_REQUIRED |
| P0 | public | `acquire_collection_worker_lease_v3(text,text,integer)` | `postgres` | no | no | no | yes | NONEMPTY | no | no | no | `cc356be85e52cfbffc9405e8897ef3e356ef7fd846a1026720607d05906e0661` | REVIEW_REQUIRED |
| P0 | public | `admin_delete_operator(uuid,text)` | `postgres` | no | no | yes | yes | NONEMPTY | yes | yes | no | `e2c70c3ad074a865b6691255dac3091857e9f3e107fc693a598e8f5c9615a457` | REVIEW_REQUIRED |
| P0 | public | `admin_unlock_operator(uuid)` | `postgres` | no | no | yes | yes | NONEMPTY | yes | yes | no | `34dd36623f7379b232a313cd9984bf07d02fa2c6bf7cc101b1802d06aac44ad9` | REVIEW_REQUIRED |
| P0 | public | `admin_update_user_password(uuid,text)` | `postgres` | no | no | no | yes | NONEMPTY | yes | no | no | `6cbe339976a6b4ef95ba80cc7eb0ae2b21fb6a0d9c90dc2cd0290a4b5fc22423` | REVIEW_REQUIRED |
| P0 | public | `admin_upsert_operator_v2(uuid,jsonb)` | `postgres` | no | no | yes | yes | NONEMPTY | yes | yes | no | `0897b23aa97a9197e8033804dfc79d37303307f1290f086d8d697ea6f6de9d77` | REVIEW_REQUIRED |
| P0 | public | `admin_upsert_operator(uuid,jsonb)` | `postgres` | no | no | yes | yes | NONEMPTY | yes | yes | no | `4d08d9f4332608774b80296d989cec68c67a3f15599a4619426cc5dc121715dd` | REVIEW_REQUIRED |
| P0 | public | `approve_piece_replacement(uuid,jsonb)` | `postgres` | no | no | yes | yes | NONEMPTY | yes | yes | no | `7eab3af5573ac3c6f0fb913307fd386cb963067ddb66c4660fd58f225d531516` | REVIEW_REQUIRED |
| P0 | public | `assert_collection_projection_schema_v3()` | `postgres` | no | no | yes | yes | NONEMPTY | no | no | no | `99a99f6e8c32ad4a6e8e8209b34d4c495ebdf2fc0cf890e2ebeb51828a873986` | REVIEW_REQUIRED |
| P0 | public | `authorize_special_release(uuid,text,text,text,text)` | `postgres` | no | no | yes | yes | NONEMPTY | yes | yes | no | `4c2c73eaba94ac38a33bca8e69183ceb814c824c4fdba140c613ced6484936ef` | REVIEW_REQUIRED |
| P0 | public | `can_approve_replacements()` | `postgres` | no | no | yes | yes | NONEMPTY | no | yes | no | `88af84472d6a45828f8c71d4b8223200c054c9a2b2bf349cc6a071fb5f517116` | REVIEW_REQUIRED |
| P0 | public | `can_force_complete_replacements()` | `postgres` | no | no | yes | yes | NONEMPTY | no | yes | no | `8e4980bf4ff266dc8477b53ee80996e26a523a2e9087a25903425a1314ad2a1f` | REVIEW_REQUIRED |
| P0 | public | `can_manage_replacement_actions()` | `postgres` | no | no | yes | yes | NONEMPTY | no | yes | no | `e588d4800bdf38e5022e3316960e161899b539aa297f9f1807f3f075fb39ec14` | REVIEW_REQUIRED |
| P0 | public | `cancel_piece_replacement_impl(uuid,jsonb)` | `postgres` | no | no | no | yes | NONEMPTY | no | no | no | `2f32bb54ac2241c6f51cfce191679fa6aaf79c8351c51ecd6012490fb55ee73c` | REVIEW_REQUIRED |
| P0 | public | `cancel_piece_replacement(uuid,jsonb)` | `postgres` | no | no | yes | yes | NONEMPTY | no | yes | no | `54b13257d90592054e4f30e76172960f81351cd7cfd776fc57c5f7bfa259bed1` | REVIEW_REQUIRED |
| P0 | public | `claim_collection_batch_v3(text,integer)` | `postgres` | no | no | no | yes | NONEMPTY | no | no | no | `e265cad1a218735e65b71b1875e01a9028454546ca9d5bb2585ffbc11007ac49` | REVIEW_REQUIRED |
| P0 | public | `claim_collection_inbox(text,integer)` | `postgres` | no | no | no | yes | NONEMPTY | no | no | no | `a843f34831c107a3a16cc025a7ab2bc90f88b97bada50ceabed6b18d0b1f5497` | REVIEW_REQUIRED |
| P0 | public | `claim_collection_projection_batch_v3(text,integer)` | `postgres` | no | no | no | yes | NONEMPTY | no | no | no | `edbc223367135aef67295679e03d3787f83fc8a023d9e20d56086d10b7e648da` | REVIEW_REQUIRED |
| P0 | public | `cleanup_capacity_fixture_v3(text)` | `postgres` | no | no | no | yes | NONEMPTY | no | no | no | `e556be2aa43547226b4d18601e8a3e8d2327a4abe99bc49d246ab9a26b391378` | REVIEW_REQUIRED |
| P0 | public | `collect_replacement_stage_v2(text,text,uuid,text,timestamp with time zone,jsonb)` | `postgres` | no | no | yes | yes | NONEMPTY | yes | no | no | `7ff8a171f5ee9904ee5972b1f0e48ee8c237b67c79ad25ccfebafeb48185cd95` | REVIEW_REQUIRED |
| P0 | public | `collect_replacement_stage_v3(text,text,uuid,text,timestamp with time zone,jsonb)` | `postgres` | no | no | yes | yes | NONEMPTY | no | no | no | `ec0f60641164c33c1fd4152a37eab8c7b10d65feb3529018387ad5cd9cbaf62f` | REVIEW_REQUIRED |
| P0 | public | `commit_pcp_import(uuid,text,text,text,text,text,integer,jsonb,boolean)` | `postgres` | no | no | yes | yes | NONEMPTY | yes | yes | no | `606a191db883b85cae079a986ae852a13c95ae784b9c4a486322d58438e2cd62` | REVIEW_REQUIRED |
| P0 | public | `complete_piece_replacement_impl(uuid,jsonb)` | `postgres` | no | no | no | yes | NONEMPTY | yes | no | no | `d971409d3a0c964d76525e96435f32eb9d3205553e090561fc30fbdfa5c772e8` | REVIEW_REQUIRED |
| P0 | public | `complete_piece_replacement(uuid,jsonb)` | `postgres` | no | no | yes | yes | NONEMPTY | no | yes | no | `a2b3bfd23bbd6d8d73fd4978e741bf2862f9441a903abade40c96cef53a1cdb0` | REVIEW_REQUIRED |
| P0 | public | `control_capacity_test_run(text,text)` | `postgres` | no | no | yes | yes | NONEMPTY | yes | no | no | `99b7512323e6b72a3fd34cf0664e12d29a7355e56605338db1720b69fa703a9e` | REVIEW_REQUIRED |
| P0 | public | `create_piece_replacement(uuid,text,text)` | `postgres` | no | no | yes | yes | NONEMPTY | yes | no | no | `25acbfc21f53528365455d7f324966aa81de3a204ca3d93fc750347d56bcfa21` | REVIEW_REQUIRED |
| P0 | public | `current_profile_can_decide_replacement()` | `postgres` | no | no | yes | yes | NONEMPTY | yes | yes | no | `72a1286708a40f3a689ca27fbbcffe918003e1771e5f81ff11f79338153ab5a0` | REVIEW_REQUIRED |
| P0 | public | `delete_promob_import_batch(uuid)` | `postgres` | no | no | yes | yes | NONEMPTY | yes | no | no | `70facd2dcf4d0a2e7d8d0d1fafa644b8d85ab16197d613e95b3a9f0d206d5de0` | REVIEW_REQUIRED |
| P0 | public | `delete_traceability_test_data()` | `postgres` | no | no | yes | yes | NONEMPTY | yes | yes | no | `cc630881783fe1823cbece95b21fceae73d90c4e42ec4f24db8eec7607ef91f9` | REVIEW_REQUIRED |
| P0 | public | `delete_user_from_auth(uuid)` | `postgres` | no | no | yes | yes | NONEMPTY | yes | yes | no | `9b16fcfe72b439df39d44891628b7166003aae5e2fc80b14c468286ca864f73a` | REVIEW_REQUIRED |
| P0 | public | `enforce_replacement_approval_permission()` | `postgres` | no | no | no | yes | NONEMPTY | no | yes | no | `dceb8d427d83664efeedf3e5a4048417405381049b9954d87ebde476be059817` | REVIEW_REQUIRED |
| P0 | public | `enrich_replacement_order_context()` | `postgres` | no | no | no | yes | NONEMPTY | no | no | no | `d5fc9d2fb2507bb66570d53eca044225a422929826cdbbdced72504a6bbcef7e` | REVIEW_REQUIRED |
| P0 | public | `finalize_collection_realtime(text,jsonb)` | `postgres` | no | no | no | yes | NONEMPTY | no | no | no | `dea35ae9cda03a48fa865ef26f582dd7e8215a55cb7a30b8c91d71753a965332` | REVIEW_REQUIRED |
| P0 | public | `finish_collection_event(uuid,text,text,jsonb,uuid,uuid,text)` | `postgres` | no | no | no | yes | NONEMPTY | no | no | no | `a0b315404492b00dfc427a4b982ed12af632ad22e54096adb3184158c8d549a1` | REVIEW_REQUIRED |
| P0 | public | `force_complete_piece_replacement_impl(uuid,text,jsonb)` | `postgres` | no | no | no | yes | NONEMPTY | yes | yes | no | `457dd6fd384ebfd140581346d0ec25845c8e2faea6bc89ebb5f240c1f7cc289a` | REVIEW_REQUIRED |
| P0 | public | `force_complete_piece_replacement(uuid,text,jsonb)` | `postgres` | no | no | yes | yes | NONEMPTY | no | yes | no | `f2bc1f2948be690e5fa0de903acc253a7aac285c6cc81ecafe4b0aea12af0a1a` | REVIEW_REQUIRED |
| P0 | public | `get_acprod_capacity_health()` | `postgres` | no | no | yes | yes | NONEMPTY | yes | no | no | `581754aa00924fb17ba23f0f7c4c19f4bbea461b519203c494ea8c5330666377` | REVIEW_REQUIRED |
| P0 | public | `get_active_replacement_operators()` | `postgres` | no | no | yes | yes | NONEMPTY | no | yes | no | `6a2fc66d0ad0ba1fa0d8ce11605fa9b6c17e0bf8fd14c195a8154bfd956db871` | REVIEW_REQUIRED |
| P0 | public | `get_collection_cell_snapshot_impl(text,uuid,text,timestamp with time zone,timestamp with time zone,uuid,uuid)` | `postgres` | no | no | no | yes | NONEMPTY | no | no | no | `5a2ec51c26324882382fc9b44d11e07c8f51354a7f1b56c05508bc16252f1c68` | REVIEW_REQUIRED |
| P0 | public | `get_collection_cell_snapshot_impl(text,uuid,text,timestamp with time zone,timestamp with time zone)` | `postgres` | no | no | no | yes | NONEMPTY | no | no | no | `f51765ba0bff4541e3ecc25b7f6ac2db5f568fa60ce7a5951d711144d68c1d62` | REVIEW_REQUIRED |
| P0 | public | `get_collection_cell_snapshot_v2(text,uuid,text,timestamp with time zone,timestamp with time zone,uuid,uuid)` | `postgres` | no | no | yes | yes | NONEMPTY | no | no | no | `a587c3d371481e423b88167e3a93f2a1c7db5b3e3f8663e97abd664e17ada9a3` | REVIEW_REQUIRED |
| P0 | public | `get_collection_cell_snapshot(text,uuid,text,timestamp with time zone,timestamp with time zone,uuid,uuid)` | `postgres` | no | no | yes | yes | NONEMPTY | no | no | no | `4e534347200ab1e6700b721368d67ab3cf6b6d1189c9b518f7ed287021dd8e92` | REVIEW_REQUIRED |
| P0 | public | `get_collection_cell_snapshot(text,uuid,text,timestamp with time zone,timestamp with time zone)` | `postgres` | no | no | yes | yes | NONEMPTY | no | no | no | `7823e06eeb2d3240efbc4b59255c9f3c71a2e92829630aade07144458332f9d8` | REVIEW_REQUIRED |
| P0 | public | `get_collection_context_summary_impl(uuid,uuid)` | `postgres` | no | no | no | yes | NONEMPTY | no | no | no | `15f8434e26419e671cd916033a1dc267c9d11d1389f282c9132dece76acd306f` | REVIEW_REQUIRED |
| P0 | public | `get_collection_context_summary(uuid,uuid)` | `postgres` | no | no | yes | yes | NONEMPTY | no | yes | no | `c46b3835634ffc0f2c52814717e4363c2f28100366a484c629aa2672d1efd7d9` | REVIEW_REQUIRED |
| P0 | public | `get_collection_dashboard_snapshot_v2(text,uuid,uuid,uuid,uuid,timestamp with time zone)` | `postgres` | no | no | yes | yes | NONEMPTY | no | no | no | `c3bf240db45002de360e0d71cc970172483824c9eea1e74fd56baae398aa97d8` | REVIEW_REQUIRED |
| P0 | public | `get_collection_dashboard_snapshot_v3(text,uuid,text,uuid,uuid,timestamp with time zone)` | `postgres` | no | no | yes | yes | NONEMPTY | no | no | no | `20e2a94855e5b81472857bd9149b67b785817c417ff76c5a637bff405bb5fd51` | REVIEW_REQUIRED |
| P0 | public | `get_collection_dashboard_snapshot_v3(text,uuid,uuid,uuid,uuid,timestamp with time zone)` | `postgres` | no | no | yes | yes | NONEMPTY | no | no | no | `d9bc1ab0d6bab9a7a48b96748886f2c734e5fced96ea2ad9811525a1e2aa93d0` | REVIEW_REQUIRED |
| P0 | public | `get_collection_history_count_impl(uuid,uuid,uuid,text,text,uuid,timestamp with time zone,timestamp with time zone,text)` | `postgres` | no | no | no | yes | NONEMPTY | no | no | no | `c26860aeb85e001c875a124f8351a2498e85d6df9d99097f8aa492bc5b90e57c` | REVIEW_REQUIRED |
| P0 | public | `get_collection_history_count(uuid,uuid,uuid,text,text,uuid,timestamp with time zone,timestamp with time zone,text)` | `postgres` | no | no | yes | yes | NONEMPTY | no | no | no | `4692ea19d8a174564029472e3c978b36df59150345ece012d1b6dfcc53a29733` | REVIEW_REQUIRED |
| P0 | public | `get_collection_history_impl(uuid,uuid,uuid,text,text,uuid,integer,integer,timestamp with time zone,timestamp with time zone,text)` | `postgres` | no | no | no | yes | NONEMPTY | no | no | no | `53597dc2a7bd390a3f2d3b9937ccb51bcb4cda668e0be073d183e04296c0d4ad` | REVIEW_REQUIRED |
| P0 | public | `get_collection_history(uuid,uuid,uuid,text,text,uuid,integer,integer,timestamp with time zone,timestamp with time zone,text)` | `postgres` | no | no | yes | yes | NONEMPTY | no | no | no | `ca10467bba285806dd690d89a3c1e296916308cefc0dd9ae0531116bca031b40` | REVIEW_REQUIRED |
| P0 | public | `get_collection_lot_route_metrics(uuid)` | `postgres` | no | no | no | yes | NONEMPTY | no | no | no | `1e1a8f6aefb2253d413ecceec808c97e3d57cec3f73171d01cd3e23894c65928` | REVIEW_REQUIRED |
| P0 | public | `get_collection_pipeline_flags_v3()` | `postgres` | no | no | yes | yes | NONEMPTY | no | no | no | `b83389e69e79f10a1449898b5a6e310a93775bcbe754e769ce7aec871108a120` | REVIEW_REQUIRED |
| P0 | public | `get_collection_route_stage_metrics(uuid,uuid,text)` | `postgres` | no | no | no | yes | NONEMPTY | no | no | no | `ba70ac45a94791d8e065315e467d3b0a48e61cdfeb9dca23c5eec6dc6adb702f` | REVIEW_REQUIRED |
| P0 | public | `get_collection_runtime_health_v3()` | `postgres` | no | no | yes | yes | NONEMPTY | no | no | no | `5b304f3e37ebe285bc3107875780f3f149a5da78dd8e8af8d4144dfa31c72e71` | REVIEW_REQUIRED |
| P0 | public | `get_promob_token(uuid)` | `postgres` | no | no | no | yes | NONEMPTY | no | no | no | `f05e1d540d10141610631e7809974fc4d045e77bb903243b359f9b4b5fe8eb15` | REVIEW_REQUIRED |
| P0 | public | `get_public_collection_micro_batch_release()` | `postgres` | no | yes | yes | yes | NONEMPTY | no | no | no | `2497dbab68311a4c14d53064e1f54570a3ccff7c0454f31e9d41241e93936c64` | REVIEW_REQUIRED |
| P0 | public | `get_public_collection_release()` | `postgres` | no | yes | yes | yes | NONEMPTY | no | yes | no | `18eb92fbcb4bd8d4fb30aac21692dfb6569b4689131aa4e3f9d3818970b90af8` | REVIEW_REQUIRED |
| P0 | public | `get_public_collection_runtime_health()` | `postgres` | no | yes | yes | yes | NONEMPTY | yes | no | no | `db02f91804f14a11613d3d110f498db75c5059741b19fe44378a1c025a255340` | REVIEW_REQUIRED |
| P0 | public | `get_public_collection_sync_release()` | `postgres` | no | yes | yes | yes | NONEMPTY | no | no | no | `d7b33cf4ea33f6938fdb09af2a1ec9ae1380d1007478d55c7104051a4c2bd6e1` | REVIEW_REQUIRED |
| P0 | public | `get_public_replacement_release()` | `postgres` | no | yes | yes | yes | NONEMPTY | no | no | no | `be8a84f32f999d612b011bee615022adb6ca2b0c8fbdd09a1af7737c09a2e42f` | REVIEW_REQUIRED |
| P0 | public | `get_replacement_approval_cells(uuid)` | `postgres` | no | no | yes | yes | NONEMPTY | no | no | no | `1c9b1efcbe790bfeda15ee7000f1e0d0bfe0ac5da236453da10b90b6ea4e6ca6` | REVIEW_REQUIRED |
| P0 | public | `get_replacement_order_context_impl(uuid)` | `postgres` | no | no | no | yes | NONEMPTY | no | no | no | `e411dc17d0bc41c9677445cdaa0f9da61ef99d10a0209b5e7c6e8cac3a897da7` | REVIEW_REQUIRED |
| P0 | public | `get_replacement_order_context(uuid)` | `postgres` | no | no | yes | yes | NONEMPTY | no | yes | no | `265decc730bf1cfc29666be08fa397dfd36c51cd381a8962c878a0a2755c776a` | REVIEW_REQUIRED |
| P0 | public | `get_replacement_station_queue_v2(text,text)` | `postgres` | no | no | yes | yes | NONEMPTY | yes | no | no | `9505957315389145cc89c9c2548ffb52124d5d1b9be33f5ba203842aa9fc1b76` | REVIEW_REQUIRED |
| P0 | public | `get_replacement_station_queue_v3(text,text)` | `postgres` | no | no | yes | yes | NONEMPTY | no | no | no | `14b27f94e9e5645474b67c0971c1154f070f574ee188744ba2e71fcf605cc4b1` | REVIEW_REQUIRED |
| P0 | public | `get_system_deployment_healthcheck()` | `postgres` | no | no | yes | yes | NONEMPTY | yes | yes | no | `bae9613ad376161913d212c20c6b6b10739d76ce6551ac4f110f41ad23f2c246` | REVIEW_REQUIRED |
| P0 | public | `heartbeat_operator_session(text)` | `postgres` | no | no | yes | yes | NONEMPTY | yes | no | no | `168c3259de36fb9abccf1375cfb527e14401500887719ebe8f140c93510ebad5` | REVIEW_REQUIRED |
| P0 | public | `ingest_collection_batch_v3(uuid,uuid,jsonb)` | `postgres` | no | no | yes | no | NONEMPTY | yes | no | no | `0538e4c2b44ee2086b1cd472fdda4494dac82c00c209f35a21f7c04b82c04f2f` | REVIEW_REQUIRED |
| P0 | public | `logout_operator_session(text)` | `postgres` | no | no | yes | yes | NONEMPTY | yes | no | no | `06264f05dcdc867eda02ccd79345d2e3347a822fa01f6702353290c7ff695dd4` | REVIEW_REQUIRED |
| P0 | public | `mirror_replacement_action_audit_to_system_logs()` | `postgres` | no | no | no | yes | NONEMPTY | no | no | no | `cb99488882dca812149a0efd0cc004f1c31c4a85f0f8213e5f0e23e5b91e7fb5` | REVIEW_REQUIRED |
| P0 | public | `normalize_replacement_step_code(text)` | `postgres` | no | no | no | yes | NONEMPTY | no | no | no | `5f27c1c07f5a24ebab96435f211daeb4d4efaeb41fac7bd621767af5cfa5f5e9` | REVIEW_REQUIRED |
| P0 | public | `operator_login_v2(text,text,text)` | `postgres` | no | no | yes | yes | NONEMPTY | yes | no | no | `559e1f4c613bda7ee97d7ae646aaa6daa7842f2b47dfc79e0f87c643c0d23207` | REVIEW_REQUIRED |
| P0 | public | `operator_login_v3(text,text,text)` | `postgres` | no | no | yes | yes | NONEMPTY | yes | no | no | `70d263709e8714370e91ca4e7e80aaab9e019f87978ff70bd5b745fa81db02c4` | REVIEW_REQUIRED |
| P0 | public | `operator_login(text,text)` | `postgres` | no | no | no | yes | NONEMPTY | no | no | no | `a2eb234de18a72afbcdb293f94be10c07517203ea38218429dfbabda12d5290c` | REVIEW_REQUIRED |
| P0 | public | `prepare_capacity_atomic_contexts_v3(text)` | `postgres` | no | no | no | yes | NONEMPTY | no | no | no | `4e075498c5246492fcc1adfd3079c481ecbb7e95ff1211067efd5ac63898dbbb` | REVIEW_REQUIRED |
| P0 | public | `process_coleta_producao_ingress()` | `postgres` | no | no | no | yes | NONEMPTY | yes | no | no | `1699be9cff92ab61dad6d99f6cd71a50b321d6d3f8bab8d266349b92ce64ff65` | REVIEW_REQUIRED |
| P0 | public | `process_collection_batch_v3(text,jsonb)` | `postgres` | no | no | no | yes | NONEMPTY | no | no | no | `812ff2764a6b8cc0757e1c8e74d98ec05729006dc64ea291c22d2a5a8f49380f` | REVIEW_REQUIRED |
| P0 | public | `process_collection_inbox_item(uuid,text)` | `postgres` | no | no | no | yes | NONEMPTY | no | no | no | `6df1f5719362d311d5d7e7e98259d8a0e664d6ff873373e0c9e017a3eea3ca10` | REVIEW_REQUIRED |
| P0 | public | `process_collection_projection_batch_v3(text,jsonb)` | `postgres` | no | no | no | yes | NONEMPTY | no | no | no | `c7607381024dfc93f9133063c1daf2f1c26003ab9b5d0927ed75118ceef58ba6` | REVIEW_REQUIRED |
| P0 | public | `process_production_reading_impl_v2(jsonb)` | `postgres` | no | no | no | yes | NONEMPTY | yes | no | no | `5f4913b9c65d1f771792eee1434cdbc4efd475bc2c87b530270bb4f9ba41304d` | REVIEW_REQUIRED |
| P0 | public | `process_production_reading_impl(jsonb)` | `postgres` | no | no | no | yes | NONEMPTY | no | no | no | `581aa8ac5b716291ef7f8c3ccf5e3cb2e26ba391b3aceb6da3fc307b470ab54c` | REVIEW_REQUIRED |
| P0 | public | `process_production_reading_v2(jsonb)` | `postgres` | no | no | yes | yes | NONEMPTY | no | no | no | `15b16688b71b5e1f425da54196c26abff5d642e9c20d64747f9737e1b374abf5` | REVIEW_REQUIRED |
| P0 | public | `process_production_reading(jsonb)` | `postgres` | no | no | yes | yes | NONEMPTY | no | no | no | `2912a113a096b50de2c76b79161a2bcfadec83e4d49e78ea0731329555f063be` | REVIEW_REQUIRED |
| P0 | public | `recalculate_replacement_lot_v2(uuid)` | `postgres` | no | no | yes | yes | NONEMPTY | no | no | no | `7b392dca67dd763484ff5f187c67d7e0364399634bca25e3bd46a3669a7d5708` | REVIEW_REQUIRED |
| P0 | public | `reconcile_collection_projection_shards_v3(uuid,text)` | `postgres` | no | no | no | yes | NONEMPTY | no | no | no | `c219cd417ba6c2ed99f9eb36f061e54029be49885046a02f947dcdd680cb91f3` | REVIEW_REQUIRED |
| P0 | public | `reconcile_general_lot_completion(uuid)` | `postgres` | no | no | no | yes | NONEMPTY | no | no | no | `d42169d91a6227566e7bd0b9cda0841abe5943e8ed65a792d1583748aa6922c3` | REVIEW_REQUIRED |
| P0 | public | `reconcile_mes_alerts(jsonb,text[])` | `postgres` | no | no | yes | yes | NONEMPTY | yes | no | no | `abb04084f2e6b6110b4972dc51592642485f662a9464982f80f4c49a2a414610` | REVIEW_REQUIRED |
| P0 | public | `reconcile_replacement_piece_trail(uuid)` | `postgres` | no | no | no | yes | NONEMPTY | no | no | no | `614f8fd372d121ce88f8382b2c8d3372e100f6073868e9dca98756da87d32185` | REVIEW_REQUIRED |
| P0 | public | `recover_collection_projection_42703_v3(text)` | `postgres` | no | no | no | yes | NONEMPTY | no | no | no | `fe0287f29d4ee908b4a811e028516bf1897e0bc0e612f85fceb81c80930c5547` | REVIEW_REQUIRED |
| P0 | public | `refresh_collection_lot_state(uuid,uuid)` | `postgres` | no | no | no | yes | NONEMPTY | no | no | no | `e0ed07c2513c4939650a0fb2c011cd5b446e51a24cc2a1ba10ead7d12e51e290` | REVIEW_REQUIRED |
| P0 | public | `register_replacement_label_print(uuid,text,text,text,text,uuid)` | `postgres` | no | no | yes | yes | NONEMPTY | yes | no | no | `360a33fd2274e64050005a303583e2f74f9feeb8821f860b5a8ade396ee9a272` | REVIEW_REQUIRED |
| P0 | public | `release_collection_worker_lease_v3(text,text)` | `postgres` | no | no | no | yes | NONEMPTY | no | no | no | `9c5b6d42ccddad849918247ff1239851076a3dd61ccd23e9600eee10bf87374b` | REVIEW_REQUIRED |
| P0 | public | `release_cover_shipment(uuid,text,text,text,text,text)` | `postgres` | no | no | yes | yes | NONEMPTY | yes | yes | no | `459451fa11526030f0f7491bcb57d259035757bfa4df31f94187da5aaa068db9` | REVIEW_REQUIRED |
| P0 | public | `release_piece_replacement_impl(uuid,jsonb)` | `postgres` | no | no | no | yes | NONEMPTY | no | no | no | `658edeebed526bb9f7b441f1b11a9c412259ff39b807f4e3608c2989b0f2c40e` | REVIEW_REQUIRED |
| P0 | public | `release_piece_replacement(uuid,jsonb)` | `postgres` | no | no | yes | yes | NONEMPTY | no | yes | no | `05f18c4bbc1e6ee8437b69fde24225745293f1d50dca45dab255040f4e77824c` | REVIEW_REQUIRED |
| P0 | public | `replacement_cell_matches_step(text,text)` | `postgres` | no | no | no | yes | NONEMPTY | no | no | no | `85afe2773af356edfee6b1409c856c16cc7cf122dfdd8c77ec238350853c9c2f` | REVIEW_REQUIRED |
| P0 | public | `replacement_operator_login_v2(text,text,text)` | `postgres` | no | no | yes | yes | NONEMPTY | yes | no | no | `900b6ed9a6c69893ef1aaea60093b20d8d70e81908e27c0378f643620cc0790b` | REVIEW_REQUIRED |
| P0 | public | `request_capacity_test_run(text,jsonb,text)` | `postgres` | no | no | yes | yes | NONEMPTY | yes | no | no | `fc51efec124a2aab0e86b3321e7b2c2f232d1894888aa7bef15ee0a0882b6e5e` | REVIEW_REQUIRED |
| P0 | public | `request_piece_replacement_impl(jsonb)` | `postgres` | no | no | no | yes | NONEMPTY | yes | no | no | `8e27fcff256ef69946a793052f94236350fab5e6d17b0dfef509e78fc246f4a1` | REVIEW_REQUIRED |
| P0 | public | `request_piece_replacement(jsonb)` | `postgres` | no | no | yes | yes | NONEMPTY | no | yes | no | `ac28756ec9923d83ac2b6ac2895773d893c3f00c10e9a954117558c921b0e298` | REVIEW_REQUIRED |
| P0 | public | `reset_production_data_impl()` | `postgres` | no | no | no | yes | NONEMPTY | yes | no | no | `70325831ca824de351920169ab60deda636c61985503c44236ac712bcef69e25` | REVIEW_REQUIRED |
| P0 | public | `reset_production_data()` | `postgres` | no | no | yes | yes | NONEMPTY | no | yes | no | `5c48ab503c2e62e0826282349913939675f0765c2da5b011749d84f6f0bda189` | REVIEW_REQUIRED |
| P0 | public | `resolve_collection_step_code(uuid,text)` | `postgres` | no | no | yes | yes | NONEMPTY | no | no | no | `fc1d3aac0fb207e11e5121104a1a85212b5873709c959553b4996b32695e319c` | REVIEW_REQUIRED |
| P0 | public | `revoke_operator_session(uuid,uuid)` | `postgres` | no | no | yes | yes | NONEMPTY | yes | yes | no | `3a318adaedad25772945b00332e49f251ec343e01cdc45bf8ae6be17b1aa5d20` | REVIEW_REQUIRED |
| P0 | public | `scan_shipment_item(jsonb)` | `postgres` | no | no | yes | yes | NONEMPTY | yes | no | no | `404deaead7ec31ccf02f4654f2b01a5ba35e62c0e9ca35387ef61194020def9e` | REVIEW_REQUIRED |
| P0 | public | `seed_capacity_fixture_v3(text,integer,text)` | `postgres` | no | no | no | yes | NONEMPTY | no | no | no | `bbcc1e1d1331229ca70077aba87de71d7f7f71baeab3504cd85bdd39da2ac10b` | REVIEW_REQUIRED |
| P0 | public | `set_collection_pipeline_flag_v3(text,boolean,jsonb)` | `postgres` | no | no | no | yes | NONEMPTY | yes | no | no | `2b1ac2e09aceb46424cb2d53747eb2831fa69fb46cadff446322a6610822acf2` | REVIEW_REQUIRED |
| P0 | public | `set_operator_session_context(text,uuid,uuid,text)` | `postgres` | no | no | yes | yes | NONEMPTY | yes | no | no | `ac239c60366f9e8a6f53d4fe09ebf210741531612abe938bf2b981fd7182cca8` | REVIEW_REQUIRED |
| P0 | public | `store_promob_token(uuid,text)` | `postgres` | no | no | no | yes | NONEMPTY | no | no | no | `d947dcaa9cb55b05417368dccc4ea98c2a34d74b67e73403326340105dde36f3` | REVIEW_REQUIRED |
| P0 | public | `sync_replacement_trail_from_reading()` | `postgres` | no | no | no | yes | NONEMPTY | no | no | no | `a780725b9e0a5bf7446d5a97c2d15f7996dd5ca0a956367f5df5f327fb4092fb` | REVIEW_REQUIRED |
| P0 | public | `verify_collection_worker_cron_secret(text)` | `postgres` | no | no | no | yes | NONEMPTY | no | no | no | `8e49a92b4715911882059cb5aaa959b3b31ca43dd4db26ad34f4b4c1377cd86d` | REVIEW_REQUIRED |
| P1 | public | `advance_piece_stage(uuid,jsonb)` | `postgres` | no | no | yes | yes | NONEMPTY | yes | yes | no | `47d777669ded82f0aad9779385562d81c8e7144a6579cc916b1ef4c13b75c7b1` | REVIEW_REQUIRED |
| P1 | public | `block_piece(uuid,text)` | `postgres` | no | no | yes | yes | NONEMPTY | yes | yes | no | `080b0fe736ceda0d5283c266d4f335cbd48bd12ef811654ec615dd0a9734b07b` | REVIEW_REQUIRED |
| P1 | public | `calcular_integridade_do_lote(uuid)` | `postgres` | no | no | yes | yes | NONEMPTY | no | yes | no | `d1884daae2920cd7a0a51884f31d3c7edae756b7311c894e9339cab2a67491b6` | REVIEW_REQUIRED |
| P1 | public | `can_access_production_lot(uuid)` | `postgres` | no | no | yes | yes | NONEMPTY | yes | yes | no | `7419137d20f832750417299d248e5161ef9b4281e8c16090bed9be647a275fc1` | REVIEW_REQUIRED |
| P1 | public | `can_access_production_order_item(uuid,uuid)` | `postgres` | no | no | yes | yes | NONEMPTY | yes | yes | no | `ba131a762ab4d6a9a2de6740cf4cc0670c45c0853964dc5f140accb445a5bd1e` | REVIEW_REQUIRED |
| P1 | public | `can_access_production_order(uuid)` | `postgres` | no | no | yes | yes | NONEMPTY | yes | yes | no | `46218da2b759788ebe3451e3872a03ca9edc64a412e20c4590de9d0e9ebb70f8` | REVIEW_REQUIRED |
| P1 | public | `can_access_production_piece(uuid)` | `postgres` | no | no | yes | yes | NONEMPTY | yes | yes | no | `a606f210c9affe6b9cdb0b8f64b6971f28aa2581675ad70409bfe83fde8fe847` | REVIEW_REQUIRED |
| P1 | public | `can_manage_occurrences()` | `postgres` | no | no | yes | yes | NONEMPTY | yes | yes | no | `4a3c1fa944f4b390bc2014c3f5d845b797b11eb8a01d8f4d1d2d27803cdb153c` | REVIEW_REQUIRED |
| P1 | public | `can_manage_operators()` | `postgres` | no | no | yes | yes | NONEMPTY | yes | yes | no | `a457fb89c13e74db240dfeb0b62982811b0b5453daf9c2a983266e22bcba8c02` | REVIEW_REQUIRED |
| P1 | public | `can_manage_production_goals()` | `postgres` | no | no | yes | yes | NONEMPTY | yes | yes | no | `3ef650c3f39978a376df4a14948117cd8c55b757168765cf72e20e3fb1f21802` | REVIEW_REQUIRED |
| P1 | public | `can_manage_quality()` | `postgres` | no | no | yes | yes | NONEMPTY | no | yes | no | `12c974dd8ea34e8cac3829514643f52c3a2eb3f3e6b694fc95f65efa45eb068e` | REVIEW_REQUIRED |
| P1 | public | `can_register_production()` | `postgres` | no | no | yes | yes | NONEMPTY | yes | no | no | `82f0f340b72459fd3a00ff73caba94b89eabf2b239c4bbb43436a46626d5df3f` | REVIEW_REQUIRED |
| P1 | public | `cancel_customer_cover(uuid,text)` | `postgres` | no | no | yes | yes | NONEMPTY | yes | yes | no | `e2c95996eea86f567ead948ff9006aee98943ddb69a2b625d41cd99e7f1d1db7` | REVIEW_REQUIRED |
| P1 | public | `cancel_piece(uuid,text)` | `postgres` | no | no | yes | yes | NONEMPTY | yes | yes | no | `89c533a063eb7e31064f7ce22d5b22a655760846769ab6107be9a681adf524bb` | REVIEW_REQUIRED |
| P1 | public | `correct_production_downtime(uuid,jsonb)` | `postgres` | no | no | yes | yes | NONEMPTY | no | yes | no | `f30de731145a586e5a3f3c9f29e22957699582e64602df85f988578265c55804` | REVIEW_REQUIRED |
| P1 | public | `create_customer_covers_for_batch(uuid)` | `postgres` | no | no | yes | yes | NONEMPTY | no | yes | no | `798f570dc62e160276a9a7fd9e99d39c0a7e8416f79d7a3d2b549d562255424d` | REVIEW_REQUIRED |
| P1 | public | `create_production_piece(jsonb)` | `postgres` | no | no | yes | yes | NONEMPTY | yes | yes | no | `f67a9bafa44ca6d95f53b2104d3279c650a41719851dab51888b01a5e76427d1` | REVIEW_REQUIRED |
| P1 | public | `create_rework_order(jsonb)` | `postgres` | no | no | yes | yes | NONEMPTY | yes | no | no | `7c59320872ebba08ed63d225296fc88600563f6600b7a864ee5fdad035b548ca` | REVIEW_REQUIRED |
| P1 | public | `current_profile_has_global_cell_access()` | `postgres` | no | no | yes | yes | NONEMPTY | yes | yes | no | `d82763c71ffc603f1ee338e29cc057ee06ff2c217af0883ad14815760b5798a5` | REVIEW_REQUIRED |
| P1 | public | `finish_production_downtime(uuid,jsonb)` | `postgres` | no | no | yes | yes | NONEMPTY | no | yes | no | `32424d04a2f26a670c339354092c1154a5a48858d503ec2d688cf72994753d6a` | REVIEW_REQUIRED |
| P1 | public | `get_ai_capability_context()` | `postgres` | no | no | yes | yes | NONEMPTY | yes | no | no | `7ba9bc414fafc984e41da032e07395fc54fa2933cdac044d9171fcd7487ad9ad` | REVIEW_REQUIRED |
| P1 | public | `get_cover_progress(uuid)` | `postgres` | no | no | yes | yes | NONEMPTY | no | yes | no | `aaafdb105577055881c98db4e2bafbd8b07513b3362c6da81b5aad87b516200d` | REVIEW_REQUIRED |
| P1 | public | `get_my_cells()` | `postgres` | no | no | yes | yes | NONEMPTY | yes | no | no | `2d3ec7e786d902180ad1cd95ebfaa9e43768b94eaa17c27f90300c08490052de` | REVIEW_REQUIRED |
| P1 | public | `get_my_role()` | `postgres` | no | no | yes | yes | NONEMPTY | yes | yes | no | `9babd9c0514403c69e4613f35dffa0c70fbe57f7563c910aba9b93acdbc2dd1a` | REVIEW_REQUIRED |
| P1 | public | `get_operator_shift_kpis_v2(text,timestamp with time zone)` | `postgres` | no | no | yes | yes | NONEMPTY | yes | no | no | `c7648bdeb47d429ff968ea97153233da12c9a6a3ed49be656cc79f75d93d6dfc` | REVIEW_REQUIRED |
| P1 | public | `get_operator_shift_kpis_v2(uuid,timestamp with time zone)` | `postgres` | no | no | yes | yes | NONEMPTY | yes | no | no | `678b9a36415b8620383ab574e90165c7a8dd77ebe7b3bcf32bac43f9c9777357` | REVIEW_REQUIRED |
| P1 | public | `has_ai_permission(text)` | `postgres` | no | no | yes | yes | NONEMPTY | yes | no | no | `1bda80583e01060b9d54ed38293b4c164c5613cf7d9d2ee9db3495038c2a61e2` | REVIEW_REQUIRED |
| P1 | public | `has_permission(text)` | `postgres` | no | no | yes | yes | NONEMPTY | yes | yes | no | `6848276025789981981a37251ef2781cbde819d9c5abff1cf238df0411b108c6` | REVIEW_REQUIRED |
| P1 | public | `normalize_route_step_code(text)` | `postgres` | no | no | yes | yes | NONEMPTY | no | no | no | `351c21283c0b843d96c8c34a4476aae953353be362dfbdc7fcb80350ae873704` | REVIEW_REQUIRED |
| P1 | public | `profile_can_access_cell(text)` | `postgres` | no | no | yes | yes | NONEMPTY | yes | no | no | `8142486709212ad0a480b5f184fc95c81d5ca7c5ded5033f5271f50a5d5718b8` | REVIEW_REQUIRED |
| P1 | public | `register_independent_finish(jsonb)` | `postgres` | no | no | yes | yes | NONEMPTY | yes | yes | no | `52c47ddcfc849860add0b66e7a3051bdb0cd078b03ff4856de64bbff129d2c33` | REVIEW_REQUIRED |
| P1 | public | `register_manual_quantitative_production(jsonb)` | `postgres` | no | no | yes | yes | NONEMPTY | yes | no | no | `caa9d71d0caeecfa79d33d0a3cc71fcc7283daa600a025eba7cdbb5cf0a03dad` | REVIEW_REQUIRED |
| P1 | public | `register_production_downtime(jsonb)` | `postgres` | no | no | yes | yes | NONEMPTY | no | yes | no | `34c6acc4c517ed10a8e045db5a4d42689622aebc3c0b2ccc714bdc8c32c2a5ad` | REVIEW_REQUIRED |
| P1 | public | `register_quality_rejection(jsonb)` | `postgres` | no | no | yes | yes | NONEMPTY | no | yes | no | `4b586452528ecf282cc6a6658313039b44326fa313814b47a7afec761ab42903` | REVIEW_REQUIRED |
| P1 | public | `register_reading_occurrence(jsonb)` | `postgres` | no | no | yes | yes | NONEMPTY | no | yes | no | `e001b73a8d6a7906a2b514958f1a6ccff6d931453c5bb825100c4fea498b2d53` | REVIEW_REQUIRED |
| P1 | public | `register_traceability_rejection(jsonb)` | `postgres` | no | no | yes | yes | NONEMPTY | yes | yes | no | `9afc4508714fffe9d304f88bfb80ca04ce675f153f1f5ac42dab7144ea761723` | REVIEW_REQUIRED |
| P1 | public | `register_untraceable_stage_quantity(jsonb)` | `postgres` | no | no | yes | yes | NONEMPTY | yes | yes | no | `ae71835aef6e147ae45ed581313cef9126299afda63029769b14e887b2ca48e3` | REVIEW_REQUIRED |
| P1 | public | `resolve_mes_alert(uuid,text)` | `postgres` | no | no | yes | yes | NONEMPTY | yes | yes | no | `fa8cd8cf559e99f705cb864fc992875e07875a0047e5e59c6c638b6d072995e7` | REVIEW_REQUIRED |
| P1 | public | `resolve_operator_shift_window(uuid,timestamp with time zone)` | `postgres` | no | no | yes | yes | NONEMPTY | yes | no | no | `6467016d2729103175df5f2d49a0dc344e124d51bd81f32105dc8a98b1ea4df4` | REVIEW_REQUIRED |
| P1 | public | `resolve_production_context(text,text)` | `postgres` | no | no | yes | yes | NONEMPTY | yes | no | no | `c611963735f17cc8f8eb970a93c035b69b0d912f0da11d245531ab0f6199ba47` | REVIEW_REQUIRED |
| P1 | public | `scan_piece_to_volume(jsonb)` | `postgres` | no | no | yes | yes | NONEMPTY | yes | no | no | `680a3fb8476823b5507adc44e1a4673a07e7a00b6b5f42ab212fceb1348dd351` | REVIEW_REQUIRED |
| P1 | public | `start_production_downtime(jsonb)` | `postgres` | no | no | yes | yes | NONEMPTY | no | yes | no | `03cb155976dd54067925c75fc817e948bffb56a4290b1e91b425b93dadfd5aab` | REVIEW_REQUIRED |
| P1 | public | `update_production_lot_status_safely(uuid,text)` | `postgres` | no | no | yes | yes | NONEMPTY | no | yes | no | `f9e852d8203d80406f69e70fe0478c420929c5a54ad6370db66d8712ba603cc1` | REVIEW_REQUIRED |
| P2 | public | `adjust_production_realtime_counter(date,uuid,text,text,text,text,text,text,uuid,text,text,text,numeric,numeric,numeric,numeric,numeric)` | `postgres` | no | no | no | yes | NONEMPTY | no | no | no | `f4f7ce3d31e79f8cdc91d09bae978baa9a2d4c68afef353ef18eedfd50b0abea` | REVIEW_REQUIRED |
| P2 | public | `archive_production_lot_payload(uuid)` | `postgres` | no | no | no | yes | NONEMPTY | no | no | no | `ddef23a3fcffbd6d76e0311602b8213bcb8d70cd909213378065c1371e374ea7` | REVIEW_REQUIRED |
| P2 | public | `audit_table_changes()` | `postgres` | no | no | no | yes | NONEMPTY | yes | no | no | `51a32e17fed66f22461176f44da874883b26dff9d9acf841bbe5b90a3c4da1fb` | REVIEW_REQUIRED |
| P2 | public | `auto_confirm_user_email()` | `postgres` | no | no | no | yes | NONEMPTY | no | no | no | `e2c2fa51fd8de327f6650caae6f1bd17e7501554b14ed7759efe0ab72e73f30d` | REVIEW_REQUIRED |
| P2 | public | `calcular_integridade_do_lote_impl(uuid)` | `postgres` | no | no | no | yes | NONEMPTY | no | no | no | `a1c624be88c1807d1d03860249b76dd1a60723cbf658f8c98e3aad21eaa19bba` | REVIEW_REQUIRED |
| P2 | public | `calculate_lot_status(uuid)` | `postgres` | no | no | no | yes | NONEMPTY | no | no | no | `f7b509c1324e05b76b7f6ac342670aa9ee5e159c7febe9a3fd31df382776c90a` | REVIEW_REQUIRED |
| P2 | public | `can_manage_operator_scope(uuid,uuid[])` | `postgres` | no | no | no | yes | NONEMPTY | yes | yes | no | `b2041fb478998824ea237e4e6c78cdc03542ce2c8a310d8432b7b5e9b11e21d2` | REVIEW_REQUIRED |
| P2 | public | `canonicalize_rejection_context()` | `postgres` | no | no | no | yes | NONEMPTY | no | no | no | `efb0a06751c013215f6244c1163b8f8b46dcfbeb8d1470a6622bace81072af8c` | REVIEW_REQUIRED |
| P2 | public | `claim_due_report_schedules(text,interval)` | `postgres` | no | no | no | yes | EMPTY | no | no | no | `e176771011d4938c451406b3b1c5a6d67d8dbfb6c976d7a22e08b859ae503f9c` | REVIEW_REQUIRED |
| P2 | public | `claim_production_archive_jobs(integer,uuid)` | `postgres` | no | no | no | yes | NONEMPTY | no | no | no | `263ff76a7960b24da7a6d70e1b0bb4290bfd82bf6bf23b0ffdfb14412894ef53` | REVIEW_REQUIRED |
| P2 | public | `complete_audit_archive_batch(uuid[],text,text,bigint,timestamp with time zone,timestamp with time zone)` | `postgres` | no | no | no | yes | NONEMPTY | no | no | no | `d70ce64d98a52b301f509c785d6ce0fdb09dffb75af7a0642f6957abb2d55a16` | REVIEW_REQUIRED |
| P2 | public | `complete_production_archive_job(uuid,uuid,text,text,bigint,jsonb,boolean)` | `postgres` | no | no | no | yes | NONEMPTY | no | no | no | `dac498a83594c44b9190854137a9ac3eca8946b7d3b37decd397acf93663b98e` | REVIEW_REQUIRED |
| P2 | public | `correct_production_downtime_impl(uuid,jsonb)` | `postgres` | no | no | no | yes | NONEMPTY | no | no | no | `303b756a116e498defba20abde8f3cb6d7df90edabc718411b96a2bd3e2ab5b7` | REVIEW_REQUIRED |
| P2 | public | `create_customer_covers_for_batch_impl(uuid)` | `postgres` | no | no | no | yes | NONEMPTY | no | no | no | `27aeebef736b14d0e9bfecbb3cf779abbbdc4ed89371044425b62f368b8d0102` | REVIEW_REQUIRED |
| P2 | public | `enforce_piece_route_state()` | `postgres` | no | no | no | yes | NONEMPTY | no | no | no | `4b8489db3850ce734389395170f456b922f9874231873290fd22c72f6d0b0d45` | REVIEW_REQUIRED |
| P2 | public | `enqueue_production_archive_jobs(integer)` | `postgres` | no | no | no | yes | NONEMPTY | no | no | no | `b6c655712db7e516e4cafe3264a552dfd10f1ddbd56d4e9f3e818a6c98e8d1ef` | REVIEW_REQUIRED |
| P2 | public | `enrich_rejected_reading_context()` | `postgres` | no | no | no | yes | NONEMPTY | no | no | no | `fb10f66bdbbcc573598e9b10e0f27cfcfe3ef4b1401d7a8d7c79ab8fe9d9e2c4` | REVIEW_REQUIRED |
| P2 | public | `fail_production_archive_job(uuid,uuid,text)` | `postgres` | no | no | no | yes | NONEMPTY | no | no | no | `763513c61bb02c5eca97bbcb2c67b42c17608e888d9100fea4abc25bc91875d6` | REVIEW_REQUIRED |
| P2 | public | `finish_production_downtime_impl(uuid,jsonb)` | `postgres` | no | no | no | yes | NONEMPTY | no | no | no | `b29c7048cda8f077bfe8ad359eba78262ca1a4cc5f36034f9dd3f523436d0fba` | REVIEW_REQUIRED |
| P2 | public | `get_active_general_lots_progress(integer)` | `postgres` | no | no | no | yes | NONEMPTY | no | no | no | `a977ffac309af3c08ad63118daf4553462d2af6a905671694c515e943538f0e9` | REVIEW_REQUIRED |
| P2 | public | `get_client_lot_progress(uuid)` | `postgres` | no | no | no | yes | NONEMPTY | no | no | no | `31375bd6da7d8dd6c750c0d8be516df037ebe905aba711314f8a11b11240c4a5` | REVIEW_REQUIRED |
| P2 | public | `get_cover_progress_impl(uuid)` | `postgres` | no | no | no | yes | NONEMPTY | no | no | no | `b7484571f0b3b943e60225cd7d65522830d0deeb07951652eb67e56835d695a3` | REVIEW_REQUIRED |
| P2 | public | `get_effective_stage_metrics(uuid,uuid,text)` | `postgres` | no | no | no | yes | NONEMPTY | no | no | no | `13baa8dbf4f996790a6e15850a2e9b8ee4a9d6bea2e11ce70e37af7722460530` | REVIEW_REQUIRED |
| P2 | public | `get_general_lot_progress(uuid)` | `postgres` | no | no | no | yes | NONEMPTY | no | no | no | `ae888953ae8e6eaffda592169670641992fa426e234238286cd86ad11226bbaf` | REVIEW_REQUIRED |
| P2 | public | `handle_alert_logs_after()` | `postgres` | no | no | no | yes | NONEMPTY | no | no | no | `f0767a4e90699b31a003fa9ddcdd7c4db1d8cc3feeb5a9c6cc01047b9cfe0a6d` | REVIEW_REQUIRED |
| P2 | public | `handle_alert_logs_before()` | `postgres` | no | no | no | yes | NONEMPTY | no | no | no | `29b72d79833c1bc6fb3f3402360c28a3179f1b7f316a26fb2e76f001298788e1` | REVIEW_REQUIRED |
| P2 | public | `handle_new_user()` | `postgres` | no | no | no | yes | NONEMPTY | no | no | no | `d19982b536ca10a9869de2a01174ad148d7a5b991e6817143352866105ec97ac` | REVIEW_REQUIRED |
| P2 | public | `handle_notification_config_change()` | `postgres` | no | no | no | yes | NONEMPTY | no | no | no | `6ba8470958b47c0a114473c3c2ba9faa4f7d823ccbbffe1f5ef3417268078b48` | REVIEW_REQUIRED |
| P2 | public | `prevent_backup_early_deletion()` | `postgres` | no | no | no | yes | NONEMPTY | yes | no | no | `2d1edc8de1e4780bdf07fe4abbb44d5bc22185b3d8bfad07f078f1ba8ce4041d` | REVIEW_REQUIRED |
| P2 | public | `protect_profile_security_fields()` | `postgres` | no | no | no | yes | NONEMPTY | yes | no | no | `51e30fcb8f9ce36f3c4825f4ab9107360a8786ca96533149c983b69ec6800595` | REVIEW_REQUIRED |
| P2 | public | `purge_archived_production_lot_detail(uuid)` | `postgres` | no | no | no | yes | NONEMPTY | no | no | no | `f2ab5ce02acfeecdb89b9c621b84553750316a69fc0cbe89dc26d3eced5a0547` | REVIEW_REQUIRED |
| P2 | public | `recalculate_cell_lot_state(uuid,text,text,uuid,uuid)` | `postgres` | no | no | no | yes | NONEMPTY | no | no | no | `794189465651570ecca58ce94b189a9e8134a06bddd9e8fa1a2e5df01f855f01` | REVIEW_REQUIRED |
| P2 | public | `refresh_pcp_batch_progress(uuid)` | `postgres` | no | no | no | yes | NONEMPTY | no | no | no | `249c33cc4279cf5a18ea23f69c6788cf2872302405b316c5a970effd6acef09d` | REVIEW_REQUIRED |
| P2 | public | `refresh_production_search_index()` | `postgres` | no | no | no | yes | NONEMPTY | no | no | no | `a1df3ddbd5afa42604e6634cc6c726e00411b9749d5e1b848ecd15057681b03d` | REVIEW_REQUIRED |
| P2 | public | `register_manual_quantitative_production_impl(jsonb)` | `postgres` | no | no | no | yes | NONEMPTY | no | no | no | `99b033fcf33502cc1c97698737c3db0f4952ea9d0b478c501fb5b22e7bf74bf0` | REVIEW_REQUIRED |
| P2 | public | `register_production_downtime_impl(jsonb)` | `postgres` | no | no | no | yes | NONEMPTY | yes | no | no | `9065d200f5daa19f50d369a8d942b0cb6d82476f11879e9b3f5bc989edfd449a` | REVIEW_REQUIRED |
| P2 | public | `register_quality_rejection_impl(jsonb)` | `postgres` | no | no | no | yes | NONEMPTY | yes | no | no | `ac2b1534c4a6eeb78c90ad3f1b46b41e33b1169a8fe1a14a1c022466bd3a6609` | REVIEW_REQUIRED |
| P2 | public | `register_reading_occurrence_impl(jsonb)` | `postgres` | no | no | no | yes | NONEMPTY | no | no | no | `1702e3cefd5be804a6a53bc11740ea73fa7e9aecde8a445214435d6f59856f97` | REVIEW_REQUIRED |
| P2 | public | `register_untraceable_stage_quantity_impl(jsonb)` | `postgres` | no | no | no | yes | EMPTY | yes | yes | no | `71ff16517869c0d895f00e3b917b038d59e600af4dbefdfc830e9832e6266679` | REVIEW_REQUIRED |
| P2 | public | `resolve_downtime_target_cell(jsonb)` | `postgres` | no | no | no | yes | NONEMPTY | no | no | no | `d0437df066c1378c1e6d926144a168a9e676313e356a7d7cb0e94bcf0dc50554` | REVIEW_REQUIRED |
| P2 | public | `resolve_piece_by_identifier(text)` | `postgres` | no | no | no | yes | NONEMPTY | no | no | no | `f772a871741b55b0b2807475ef7bd3b24cdf5f534e071b0e309fbb33500cb232` | REVIEW_REQUIRED |
| P2 | public | `reverse_production_entry_after_rejection()` | `postgres` | no | no | no | yes | NONEMPTY | no | no | no | `493d667bbcb55b6fd80b61657b9d5da3e48edcb49391f4d2c6a5f87a375bb660` | REVIEW_REQUIRED |
| P2 | public | `snapshot_operator_name()` | `postgres` | no | no | no | yes | NONEMPTY | no | no | no | `67c03282ae064a9e9cb40c0728accf613267754e513158c00d2303069456bd9b` | REVIEW_REQUIRED |
| P2 | public | `start_production_downtime_impl(jsonb)` | `postgres` | no | no | no | yes | NONEMPTY | yes | no | no | `7b590c2f3be1bed911d4cd2e39a616ddfbd67228ed0864dd485df98583e60da5` | REVIEW_REQUIRED |
| P2 | public | `switch_cell_active_lot_context(text,text,uuid,uuid,uuid,timestamp with time zone,text)` | `postgres` | no | no | no | yes | NONEMPTY | no | no | no | `9582ae4b912b67bb3253338d35e3a49cb0aebcb66cdbab623f0f950cee857c95` | REVIEW_REQUIRED |
| P2 | public | `sync_pcp_batch_progress_from_piece()` | `postgres` | no | no | no | yes | NONEMPTY | no | no | no | `8442d5bae9fc366b0b0739695f811a7675a8ff775b869cc70434adcb1cbbc430` | REVIEW_REQUIRED |
| P2 | public | `sync_realtime_counter_from_production_entry()` | `postgres` | no | no | no | yes | NONEMPTY | no | no | no | `84f98227ada476f4f83b7d7fb5b894e8b613f6cc514969129290b4e11175264d` | REVIEW_REQUIRED |
| P2 | public | `sync_realtime_counter_from_stage_reading()` | `postgres` | no | no | no | yes | NONEMPTY | no | no | no | `7b0bc311c3fefafa18988f63bbf17aafa417b048c72fe4062712bd235fc6e125` | REVIEW_REQUIRED |
| P2 | public | `sync_report_schedule_recipients()` | `postgres` | no | no | no | yes | NONEMPTY | no | no | no | `ac55d1b69918cef976e398f2a7859e36ad9ab3dbcbe40c4cfa4b16d0b96c4113` | REVIEW_REQUIRED |
| P2 | public | `update_production_lot_status_safely_impl(uuid,text)` | `postgres` | no | no | no | yes | NONEMPTY | no | no | no | `60b761fe206825db77dc2de78bf063d4b094f7a2c48bc27146cec0f9944e605f` | REVIEW_REQUIRED |
| P2 | public | `validate_separation_ready(uuid)` | `postgres` | no | no | no | yes | NONEMPTY | no | no | no | `70e690786707c017a6c72a4d1e6b6add5a74f1ec4846e12c85107194024514d6` | REVIEW_REQUIRED |
| P2 | public | `verify_archive_cron_secret(text)` | `postgres` | no | no | no | yes | NONEMPTY | no | no | no | `1826c8211abf40693cd8bb746053fd20e380042466e50996160ebeee328b5ffc` | REVIEW_REQUIRED |
| P2 | public | `verify_report_cron_secret(text)` | `postgres` | no | no | no | yes | NONEMPTY | no | no | no | `2485365d31354bf617074faef576e14c1987db90e9135c155fe907ad3d6b6ba9` | REVIEW_REQUIRED |

## Gate de revisão semântica

Para cada overload, a revisão futura deve registrar: necessidade do definer;
owner dedicado; objetos tocados; identidade confiável; autorização por role e
setor; limites de input/JSON; classificação e sanitização de erro; grants finais;
e IDs de testes positivo, negativo, anon, cross-sector e retry. Nenhuma linha
muda para APPROVED apenas por conter um sinal textual.
