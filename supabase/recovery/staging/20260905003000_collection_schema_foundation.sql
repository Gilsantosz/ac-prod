-- Staging-only additive recovery foundation. Generated from qualified catalog evidence.

-- No legacy migration is edited, no row is replayed, no worker or trigger is enabled.

-- Source object selection SHA-256: d740353826e364449dd765cf9d4589ca0c98623d0f453c13717d60281fee5ecc

SET LOCAL lock_timeout = '2s';

SET LOCAL statement_timeout = '30s';

SET LOCAL search_path = '';

DO $recovery_preflight$ BEGIN

  IF pg_catalog.to_regclass('public.coletas_producao') IS NOT NULL THEN

    RAISE EXCEPTION 'RECOVERY_TARGET_ALREADY_INITIALIZED' USING ERRCODE = '55000';

  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='capacity_test_runs' AND column_name='synthetic_prefix') THEN

    RAISE EXCEPTION 'RECOVERY_TARGET_NOT_STAGING_LINEAGE' USING ERRCODE = '55000';

  END IF;

END $recovery_preflight$;

CREATE SCHEMA IF NOT EXISTS private;

REVOKE ALL ON SCHEMA private FROM PUBLIC, anon, authenticated;

-- catalog_sha256 3fa239a78e37c305bc09f58cd7f8d64a2141b765b4ca87e1b4f8baa0df86db22

CREATE TABLE private.capacity_test_fixture_objects (
  "run_id" text COLLATE pg_catalog."default" NOT NULL,
  "entity_kind" text COLLATE pg_catalog."default" NOT NULL,
  "entity_id" uuid NOT NULL,
  "created_by_test" boolean DEFAULT true NOT NULL,
  "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL
);

ALTER TABLE private.capacity_test_fixture_objects ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE private.capacity_test_fixture_objects FROM PUBLIC, anon, authenticated, service_role;

-- catalog_sha256 ec75cdaa1d17616f320ee49c9f41bbc4f6553af08e7aa448ac2426e2c5436a5d

CREATE TABLE private.coleta_producao_credentials (
  "coleta_id" uuid NOT NULL,
  "auth_user_id" uuid NOT NULL,
  "session_token" text COLLATE pg_catalog."default" NOT NULL,
  "created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
  "expires_at" timestamp with time zone DEFAULT (clock_timestamp() + '2 days'::interval) NOT NULL
);

ALTER TABLE private.coleta_producao_credentials ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE private.coleta_producao_credentials FROM PUBLIC, anon, authenticated, service_role;

-- catalog_sha256 aa667d4a00ad903f5a06d26ab2b2f07fb0152359458c2cfd71cc4f5e4af28892

CREATE TABLE private.collection_pipeline_flags (
  "flag_name" text COLLATE pg_catalog."default" NOT NULL,
  "enabled" boolean DEFAULT false NOT NULL,
  "rollout_scope" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "updated_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
  "updated_by" uuid
);

ALTER TABLE private.collection_pipeline_flags ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE private.collection_pipeline_flags FROM PUBLIC, anon, authenticated, service_role;

-- catalog_sha256 8d8b89c7c66dc9344aba39a4fc29beef9b847b1562d2c22e693ae8fd62a177f9

CREATE TABLE private.collection_projection_recovery_audit (
  "run_id" text COLLATE pg_catalog."default" NOT NULL,
  "outbox_id" uuid NOT NULL,
  "client_event_id" text COLLATE pg_catalog."default" NOT NULL,
  "original_error_code" text COLLATE pg_catalog."default" NOT NULL,
  "recovered_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
  "recovery_message_id" bigint,
  "status" text COLLATE pg_catalog."default" NOT NULL,
  "detail" text COLLATE pg_catalog."default"
);

ALTER TABLE private.collection_projection_recovery_audit ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE private.collection_projection_recovery_audit FROM PUBLIC, anon, authenticated, service_role;

-- catalog_sha256 7a44f86e5e490837a61a4aaa09fbfd2d09e2f1adca6ef0fb7818b056209801b3

CREATE TABLE private.collection_projection_trigger_registry (
  "trigger_name" text COLLATE pg_catalog."default" NOT NULL,
  "relation_name" regclass NOT NULL,
  "function_name" regprocedure NOT NULL,
  "original_definition" text COLLATE pg_catalog."default" NOT NULL,
  "original_definition_sha256" text COLLATE pg_catalog."default" NOT NULL,
  "installed_trigger_names" text[] COLLATE pg_catalog."default" DEFAULT '{}'::text[] NOT NULL,
  "guard_installed" boolean DEFAULT false NOT NULL,
  "captured_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
  "restored_at" timestamp with time zone
);

ALTER TABLE private.collection_projection_trigger_registry ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE private.collection_projection_trigger_registry FROM PUBLIC, anon, authenticated, service_role;

-- catalog_sha256 975869520c88e8cef562b8dfd1487b81a1e7759fd4f29d4207d06f73939377fa

CREATE TABLE private.collection_worker_heartbeats (
  "worker_id" text COLLATE pg_catalog."default" NOT NULL,
  "worker_kind" text COLLATE pg_catalog."default" NOT NULL,
  "invocation_id" text COLLATE pg_catalog."default",
  "started_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
  "heartbeat_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
  "finished_at" timestamp with time zone,
  "claimed_count" integer DEFAULT 0 NOT NULL,
  "finalized_count" integer DEFAULT 0 NOT NULL,
  "last_error_code" text COLLATE pg_catalog."default"
);

ALTER TABLE private.collection_worker_heartbeats ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE private.collection_worker_heartbeats FROM PUBLIC, anon, authenticated, service_role;

-- catalog_sha256 87b70384dd371abeee119539d733d75ba331e8d230a0952dfc7d9e2378de9af9

CREATE TABLE private.collection_worker_leases_v3 (
  "worker_kind" text COLLATE pg_catalog."default" NOT NULL,
  "lease_owner" text COLLATE pg_catalog."default" NOT NULL,
  "acquired_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
  "heartbeat_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "updated_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL
);

ALTER TABLE private.collection_worker_leases_v3 ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE private.collection_worker_leases_v3 FROM PUBLIC, anon, authenticated, service_role;

-- catalog_sha256 10fd3f583b4a3c14447e8b8a69c59e0a5484a2870421080e38b1e58a5297443c

CREATE TABLE public.app_schema_releases (
  "version" text COLLATE pg_catalog."default" NOT NULL,
  "applied_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
  "checksum" text COLLATE pg_catalog."default",
  "notes" text COLLATE pg_catalog."default",
  "migration_version" text COLLATE pg_catalog."default",
  "ready" boolean DEFAULT false NOT NULL,
  "schema_flags" jsonb DEFAULT '{}'::jsonb NOT NULL
);

ALTER TABLE public.app_schema_releases ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.app_schema_releases FROM PUBLIC, anon, authenticated, service_role;

-- catalog_sha256 c2ef7dd3ef8bbb9a39fb82a89931a2e326970e9fa1607551a02fe5e7ef4710ea

CREATE TABLE public.audit_archive_manifests (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "storage_bucket" text COLLATE pg_catalog."default" DEFAULT 'production-archive'::text NOT NULL,
  "storage_path" text COLLATE pg_catalog."default" NOT NULL,
  "sha256" text COLLATE pg_catalog."default" NOT NULL,
  "object_size_bytes" bigint NOT NULL,
  "row_count" integer NOT NULL,
  "period_start" timestamp with time zone NOT NULL,
  "period_end" timestamp with time zone NOT NULL,
  "archived_at" timestamp with time zone DEFAULT now() NOT NULL,
  "retention_until" timestamp with time zone NOT NULL,
  "deleted_at" timestamp with time zone,
  "deletion_tombstone" jsonb,
  "legal_hold" boolean DEFAULT false NOT NULL,
  "status" text COLLATE pg_catalog."default" DEFAULT 'purged'::text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE public.audit_archive_manifests ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.audit_archive_manifests FROM PUBLIC, anon, authenticated, service_role;

-- catalog_sha256 02a13bb54262bbe0d71e9799737ed64f79b971e0fe3589dce70e138effbdfe51

CREATE TABLE public.coletas_producao (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "client_event_id" text COLLATE pg_catalog."default" NOT NULL,
  "tag_lida" text COLLATE pg_catalog."default" NOT NULL,
  "timestamp_leitura" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
  "status_sincronizacao" text COLLATE pg_catalog."default" DEFAULT 'recebida'::text NOT NULL,
  "event_kind" text COLLATE pg_catalog."default" DEFAULT 'production_stage'::text NOT NULL,
  "reader_type" text COLLATE pg_catalog."default" DEFAULT 'keyboard_barcode'::text NOT NULL,
  "device_id" text COLLATE pg_catalog."default",
  "batch_id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "batch_sequence" integer DEFAULT 0 NOT NULL,
  "payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "resultado" jsonb,
  "erro" text COLLATE pg_catalog."default",
  "retryable" boolean DEFAULT false NOT NULL,
  "auth_user_id" uuid DEFAULT auth.uid() NOT NULL,
  "server_received_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
  "processado_em" timestamp with time zone,
  "processing_duration_ms" numeric(12,3),
  "created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
  "attempt_count" integer DEFAULT 0 NOT NULL,
  "next_attempt_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
  "lease_expires_at" timestamp with time zone,
  "worker_id" text COLLATE pg_catalog."default",
  "last_error_code" text COLLATE pg_catalog."default",
  "last_error_at" timestamp with time zone,
  "queue_delay_ms" numeric(12,3),
  "pipeline_version" smallint DEFAULT 2 NOT NULL,
  "device_sequence" bigint,
  "captured_at_client" timestamp with time zone,
  "received_at_db" timestamp with time zone,
  "enqueued_at" timestamp with time zone,
  "claimed_at" timestamp with time zone,
  "processing_started_at" timestamp with time zone,
  "decision_committed_at" timestamp with time zone,
  "projected_at" timestamp with time zone,
  "broadcasted_at" timestamp with time zone,
  "source_mode" text COLLATE pg_catalog."default" DEFAULT 'live'::text NOT NULL,
  "operator_session_id" uuid,
  "operator_id" uuid,
  "cell_id" uuid,
  "machine_id" uuid,
  "app_version" text COLLATE pg_catalog."default",
  "final_reason_code" text COLLATE pg_catalog."default",
  "dead_lettered_at" timestamp with time zone,
  "queue_name" text COLLATE pg_catalog."default",
  "queue_message_id" bigint
);

ALTER TABLE public.coletas_producao ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.coletas_producao FROM PUBLIC, anon, authenticated, service_role;

-- catalog_sha256 95fb58cada363d56d2ae1ae40f1d2da2f6c7680a2106d6d5c461b6280111f949

CREATE TABLE public.collection_processing_attempts (
  "id" bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  "client_event_id" text COLLATE pg_catalog."default" NOT NULL,
  "attempt_number" integer NOT NULL,
  "worker_id" text COLLATE pg_catalog."default" NOT NULL,
  "queue_name" text COLLATE pg_catalog."default" NOT NULL,
  "claimed_at" timestamp with time zone,
  "processing_started_at" timestamp with time zone,
  "processing_finished_at" timestamp with time zone,
  "queue_delay_ms" numeric(14,3),
  "processing_duration_ms" numeric(14,3),
  "sqlstate" text COLLATE pg_catalog."default",
  "reason_code" text COLLATE pg_catalog."default",
  "retryable" boolean DEFAULT false NOT NULL,
  "backoff_ms" integer,
  "lock_wait_ms" numeric(14,3),
  "error_message" text COLLATE pg_catalog."default",
  "created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL
);

ALTER TABLE public.collection_processing_attempts ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.collection_processing_attempts FROM PUBLIC, anon, authenticated, service_role;

-- catalog_sha256 6c64014457e45332909239cdd34afc95a73d40761a6c40c0159cdbe13d76b631

CREATE TABLE public.collection_projection_applied (
  "outbox_id" uuid NOT NULL,
  "projection_type" text COLLATE pg_catalog."default" NOT NULL,
  "applied_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
  "payload_checksum" text COLLATE pg_catalog."default"
);

ALTER TABLE public.collection_projection_applied ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.collection_projection_applied FROM PUBLIC, anon, authenticated, service_role;

-- catalog_sha256 56529bbbc65fcc82638260ed097732f8b53d04a735eaf275de95d198f873ecb7

CREATE TABLE public.collection_projection_outbox (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "client_event_id" text COLLATE pg_catalog."default" NOT NULL,
  "projection_revision" integer DEFAULT 0 NOT NULL,
  "projection_kind" text COLLATE pg_catalog."default" DEFAULT 'decision'::text NOT NULL,
  "previous_decision" text COLLATE pg_catalog."default",
  "reading_id" uuid,
  "piece_id" uuid,
  "lot_id" uuid,
  "cell_id" uuid,
  "machine_id" uuid,
  "operator_id" uuid,
  "shift_id" uuid,
  "shift_snapshot" text COLLATE pg_catalog."default",
  "step_code" text COLLATE pg_catalog."default",
  "decision" text COLLATE pg_catalog."default" NOT NULL,
  "quantity" integer DEFAULT 1 NOT NULL,
  "payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
  "available_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
  "attempt_count" integer DEFAULT 0 NOT NULL,
  "projected_at" timestamp with time zone,
  "projection_lag_ms" numeric(14,3),
  "queue_message_id" bigint,
  "last_error_code" text COLLATE pg_catalog."default",
  "dead_lettered_at" timestamp with time zone
);

ALTER TABLE public.collection_projection_outbox ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.collection_projection_outbox FROM PUBLIC, anon, authenticated, service_role;

-- catalog_sha256 0a400e469bde7bcdf0d678a5a1a651b7ff294d7b9693dd65e353a4a44c01c0a9

CREATE TABLE public.pcp_import_chunks (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "batch_id" uuid NOT NULL,
  "chunk_number" integer NOT NULL,
  "total_chunks" integer NOT NULL,
  "source_line" integer NOT NULL,
  "last_source_line" integer NOT NULL,
  "row_count" integer NOT NULL,
  "row_hash" text COLLATE pg_catalog."default" NOT NULL,
  "normalized_storage_path" text COLLATE pg_catalog."default" NOT NULL,
  "status" text COLLATE pg_catalog."default" DEFAULT 'pending'::text NOT NULL,
  "retry_count" integer DEFAULT 0 NOT NULL,
  "error_message" text COLLATE pg_catalog."default",
  "verified_at" timestamp with time zone,
  "processed_at" timestamp with time zone,
  "created_by" uuid DEFAULT auth.uid() NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE public.pcp_import_chunks ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.pcp_import_chunks FROM PUBLIC, anon, authenticated, service_role;

-- catalog_sha256 2400354120c504c55ba0ee18591d16b3f622a1dc68cd96e243eb778813c85345

CREATE TABLE public.pcp_import_manifests (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "batch_id" uuid NOT NULL,
  "original_storage_path" text COLLATE pg_catalog."default" NOT NULL,
  "normalized_storage_prefix" text COLLATE pg_catalog."default" NOT NULL,
  "manifest_storage_path" text COLLATE pg_catalog."default" NOT NULL,
  "original_sha256" text COLLATE pg_catalog."default" NOT NULL,
  "normalized_sha256" text COLLATE pg_catalog."default" NOT NULL,
  "manifest_sha256" text COLLATE pg_catalog."default" NOT NULL,
  "source_size" bigint NOT NULL,
  "rows_count" integer NOT NULL,
  "chunks_count" integer NOT NULL,
  "parser_version" text COLLATE pg_catalog."default" NOT NULL,
  "status" text COLLATE pg_catalog."default" DEFAULT 'verified'::text NOT NULL,
  "verified_at" timestamp with time zone,
  "retention_until" timestamp with time zone DEFAULT (now() + '3 years'::interval) NOT NULL,
  "created_by" uuid DEFAULT auth.uid() NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE public.pcp_import_manifests ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.pcp_import_manifests FROM PUBLIC, anon, authenticated, service_role;

-- catalog_sha256 60b098c41c3059df0db79909ea9676bf060671dfe01efe3b19ebe43d0397e6d8

CREATE TABLE public.production_archive_jobs (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "lot_id" uuid NOT NULL,
  "status" text COLLATE pg_catalog."default" DEFAULT 'pending'::text NOT NULL,
  "attempt_count" integer DEFAULT 0 NOT NULL,
  "available_at" timestamp with time zone DEFAULT now() NOT NULL,
  "locked_at" timestamp with time zone,
  "lock_token" uuid,
  "started_at" timestamp with time zone,
  "finished_at" timestamp with time zone,
  "last_error" text COLLATE pg_catalog."default",
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE public.production_archive_jobs ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.production_archive_jobs FROM PUBLIC, anon, authenticated, service_role;

-- catalog_sha256 45b238b64245ee4c0f7d951f67632cd2c5e2d80298d500d96db79fc81ba2a719

CREATE TABLE public.production_archive_manifests (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "job_id" uuid NOT NULL,
  "lot_id" uuid NOT NULL,
  "storage_bucket" text COLLATE pg_catalog."default" DEFAULT 'production-archive'::text NOT NULL,
  "storage_path" text COLLATE pg_catalog."default" NOT NULL,
  "content_type" text COLLATE pg_catalog."default" DEFAULT 'application/gzip'::text NOT NULL,
  "schema_version" integer DEFAULT 1 NOT NULL,
  "sha256" text COLLATE pg_catalog."default" NOT NULL,
  "object_size_bytes" bigint NOT NULL,
  "row_counts" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "archived_at" timestamp with time zone DEFAULT now() NOT NULL,
  "verified_at" timestamp with time zone NOT NULL,
  "purged_at" timestamp with time zone,
  "retention_until" timestamp with time zone NOT NULL,
  "deleted_at" timestamp with time zone,
  "deletion_tombstone" jsonb,
  "status" text COLLATE pg_catalog."default" DEFAULT 'verified'::text NOT NULL,
  "legal_hold" boolean DEFAULT false NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE public.production_archive_manifests ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.production_archive_manifests FROM PUBLIC, anon, authenticated, service_role;

-- catalog_sha256 70bd6c490aedc6f5cffc6124f666f45c778fcd799fc00878193d17eebbc18da5

CREATE TABLE public.production_cell_active_contexts (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "cell_id" uuid,
  "cell_name" text COLLATE pg_catalog."default" NOT NULL,
  "step_code" text COLLATE pg_catalog."default" NOT NULL,
  "machine_id" uuid,
  "active_lot_id" uuid,
  "active_lot_code" text COLLATE pg_catalog."default",
  "active_pcp_import_batch_id" uuid,
  "active_general_lot_code" text COLLATE pg_catalog."default",
  "source_client_event_id" text COLLATE pg_catalog."default",
  "activated_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
  "last_event_occurred_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
  "state_version" bigint DEFAULT 1 NOT NULL,
  "created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL
);

ALTER TABLE public.production_cell_active_contexts ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.production_cell_active_contexts FROM PUBLIC, anon, authenticated, service_role;

-- catalog_sha256 c6a75a370a14fbd534b05d8f3dd17e4a84bc63868b50b426d1b6eb10ad829a9b

CREATE TABLE public.production_cell_lot_states (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "pcp_import_batch_id" uuid,
  "general_lot_code" text COLLATE pg_catalog."default",
  "lot_id" uuid NOT NULL,
  "lot_code" text COLLATE pg_catalog."default",
  "cell_id" uuid,
  "cell_name" text COLLATE pg_catalog."default" NOT NULL,
  "step_code" text COLLATE pg_catalog."default" NOT NULL,
  "machine_id" uuid,
  "status" text COLLATE pg_catalog."default" DEFAULT 'active'::text NOT NULL,
  "expected_count" bigint DEFAULT 0 NOT NULL,
  "approved_count" bigint DEFAULT 0 NOT NULL,
  "rejected_count" bigint DEFAULT 0 NOT NULL,
  "pending_count" bigint DEFAULT 0 NOT NULL,
  "rework_count" bigint DEFAULT 0 NOT NULL,
  "replacement_count" bigint DEFAULT 0 NOT NULL,
  "started_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
  "activated_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
  "paused_at" timestamp with time zone,
  "closed_at" timestamp with time zone,
  "last_event_occurred_at" timestamp with time zone,
  "closed_by_operator_id" uuid,
  "close_reason" text COLLATE pg_catalog."default",
  "state_version" bigint DEFAULT 1 NOT NULL,
  "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL
);

ALTER TABLE public.production_cell_lot_states ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.production_cell_lot_states FROM PUBLIC, anon, authenticated, service_role;

-- catalog_sha256 1c3ef7ecd82aca5e9a23283a47145c434fff871ed99094d6ec6a29491d458474

CREATE TABLE public.production_lot_stage_aggregates (
  "lot_id" uuid NOT NULL,
  "step_code" text COLLATE pg_catalog."default" NOT NULL,
  "approved_count" bigint DEFAULT 0 NOT NULL,
  "last_reading_id" uuid,
  "last_event_at" timestamp with time zone,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE public.production_lot_stage_aggregates ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.production_lot_stage_aggregates FROM PUBLIC, anon, authenticated, service_role;

-- catalog_sha256 0391c4d258b064f21df34455736a4db312018062962c55ba012b4b21de897b23

CREATE TABLE public.production_lot_stage_counter_shards (
  "lot_id" uuid NOT NULL,
  "step_code" text COLLATE pg_catalog."default" NOT NULL,
  "shard_number" smallint NOT NULL,
  "approved_count" bigint DEFAULT 0 NOT NULL,
  "rejected_count" bigint DEFAULT 0 NOT NULL,
  "blocked_count" bigint DEFAULT 0 NOT NULL,
  "duplicated_count" bigint DEFAULT 0 NOT NULL,
  "pending_review_count" bigint DEFAULT 0 NOT NULL,
  "quantity_total" bigint DEFAULT 0 NOT NULL,
  "state_version" bigint DEFAULT 0 NOT NULL,
  "updated_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL
);

ALTER TABLE public.production_lot_stage_counter_shards ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.production_lot_stage_counter_shards FROM PUBLIC, anon, authenticated, service_role;

-- catalog_sha256 abe8622213067251f493c40fd4df307bc6d617eba78c06626df2a7e85217003f

CREATE TABLE public.promob_trusted_origins (
  "origin" text COLLATE pg_catalog."default" NOT NULL,
  "active" boolean DEFAULT true NOT NULL,
  "created_by" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE public.promob_trusted_origins ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.promob_trusted_origins FROM PUBLIC, anon, authenticated, service_role;

-- catalog_sha256 0eff5308c9317c03d84e33076e62870e4595ddc22c7a1347244702ca0b849a07

CREATE TABLE public.replacement_action_audit_logs (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "replacement_order_id" uuid NOT NULL,
  "replacement_code" text COLLATE pg_catalog."default",
  "action" text COLLATE pg_catalog."default" NOT NULL,
  "performed_by" uuid,
  "performed_by_name" text COLLATE pg_catalog."default",
  "performed_by_role" text COLLATE pg_catalog."default",
  "reason" text COLLATE pg_catalog."default",
  "status_before" text COLLATE pg_catalog."default",
  "status_after" text COLLATE pg_catalog."default",
  "original_piece_id" uuid,
  "replacement_piece_id" uuid,
  "current_stage_before" text COLLATE pg_catalog."default",
  "current_stage_after" text COLLATE pg_catalog."default",
  "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL
);

ALTER TABLE public.replacement_action_audit_logs ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.replacement_action_audit_logs FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON SEQUENCE public.collection_processing_attempts_id_seq FROM PUBLIC, anon, authenticated, service_role;

ALTER TABLE public.occurrences ADD COLUMN "piece_id" uuid;

ALTER TABLE public.operator_sessions ADD COLUMN "shift_start_time_snapshot" time without time zone;

ALTER TABLE public.operator_sessions ADD COLUMN "shift_end_time_snapshot" time without time zone;

ALTER TABLE public.operator_sessions ADD COLUMN "shift_started_at" timestamp with time zone;

ALTER TABLE public.operator_sessions ADD COLUMN "shift_ends_at" timestamp with time zone;

ALTER TABLE public.operator_sessions ADD COLUMN "shift_work_date" date;

ALTER TABLE public.operator_sessions ADD COLUMN "timezone_snapshot" text COLLATE pg_catalog."default";

ALTER TABLE public.operators ADD COLUMN "shift_start_time" time without time zone DEFAULT '06:00:00'::time without time zone NOT NULL;

ALTER TABLE public.operators ADD COLUMN "shift_end_time" time without time zone DEFAULT '14:00:00'::time without time zone NOT NULL;

ALTER TABLE public.operators ADD COLUMN "timezone" text COLLATE pg_catalog."default" DEFAULT 'America/Sao_Paulo'::text NOT NULL;

ALTER TABLE public.production_collection_events ADD COLUMN "lot_state_version" bigint;

ALTER TABLE public.production_collection_events ADD COLUMN "broadcasted_at" timestamp with time zone;

ALTER TABLE public.production_collection_events ADD COLUMN "broadcast_error" text COLLATE pg_catalog."default";

ALTER TABLE public.production_collection_events ADD COLUMN "occurred_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL;

ALTER TABLE public.production_collection_events ADD COLUMN "timestamp_adjusted" boolean DEFAULT false NOT NULL;

ALTER TABLE public.production_collection_events ADD COLUMN "reason_code" text COLLATE pg_catalog."default";

ALTER TABLE public.production_collection_events ADD COLUMN "pipeline_version" smallint DEFAULT 2 NOT NULL;

ALTER TABLE public.production_collection_events ADD COLUMN "decision_committed_at" timestamp with time zone;

ALTER TABLE public.production_collection_events ADD COLUMN "projected_at" timestamp with time zone;

ALTER TABLE public.production_collection_events ADD COLUMN "final_reason_code" text COLLATE pg_catalog."default";

ALTER TABLE public.production_entries ADD COLUMN "is_manual" boolean DEFAULT false;

ALTER TABLE public.production_entries ADD COLUMN "unit_of_measure" text COLLATE pg_catalog."default" DEFAULT 'pecas'::text;

ALTER TABLE public.production_lots ADD COLUMN "state_version" bigint DEFAULT 0 NOT NULL;

ALTER TABLE public.production_lots ADD COLUMN "closed_at" timestamp with time zone;

ALTER TABLE public.production_lots ADD COLUMN "retention_until" timestamp with time zone;

ALTER TABLE public.production_lots ADD COLUMN "legal_hold" boolean DEFAULT false NOT NULL;

ALTER TABLE public.production_lots ADD COLUMN "detail_archived_at" timestamp with time zone;

ALTER TABLE public.production_lots ADD COLUMN "archive_manifest_id" uuid;

ALTER TABLE public.production_lots ADD COLUMN "archive_storage_path" text COLLATE pg_catalog."default";

ALTER TABLE public.production_pieces ADD COLUMN "general_lot_code" text COLLATE pg_catalog."default";

ALTER TABLE public.production_stage_readings ADD COLUMN "lot_state_version" bigint;

ALTER TABLE public.production_stage_readings ADD COLUMN "raw_value" text COLLATE pg_catalog."default" GENERATED ALWAYS AS (tag_value) STORED;

ALTER TABLE public.production_stage_readings ADD COLUMN "traceability_code" text COLLATE pg_catalog."default" GENERATED ALWAYS AS (COALESCE(piece_code, tag_value)) STORED;

ALTER TABLE public.production_stage_readings ADD COLUMN "pipeline_version" smallint DEFAULT 2 NOT NULL;

ALTER TABLE public.promob_import_batches ADD COLUMN "original_storage_path" text COLLATE pg_catalog."default";

ALTER TABLE public.promob_import_batches ADD COLUMN "normalized_storage_prefix" text COLLATE pg_catalog."default";

ALTER TABLE public.promob_import_batches ADD COLUMN "manifest_storage_path" text COLLATE pg_catalog."default";

ALTER TABLE public.promob_import_batches ADD COLUMN "parser_version" text COLLATE pg_catalog."default";

ALTER TABLE public.promob_import_batches ADD COLUMN "backup_verified_at" timestamp with time zone;

-- catalog_sha256 ee0028cc7a0ea288d4a080c0700b206bb05ccbf3a1c5cf38162feb1d2791769d

ALTER TABLE private.capacity_test_fixture_objects ADD CONSTRAINT "capacity_test_fixture_objects_pkey" PRIMARY KEY (run_id, entity_kind, entity_id);

-- catalog_sha256 e3cf8f98b77de9f7ea2186996f14cc7ede11b38b07b458c3b8eaceb4f9fa867e

ALTER TABLE private.coleta_producao_credentials ADD CONSTRAINT "coleta_producao_credentials_pkey" PRIMARY KEY (coleta_id);

-- catalog_sha256 07c62d129e82f52e7188dbc22b5a2a4cb2347484423689697e6b7b7e6a13aa26

ALTER TABLE private.collection_pipeline_flags ADD CONSTRAINT "collection_pipeline_flags_name_check" CHECK ((flag_name = ANY (ARRAY['collection_pipeline_v3_ingress'::text, 'collection_pipeline_v3_worker'::text, 'collection_pipeline_v3_projection'::text, 'collection_pipeline_v3_broadcast'::text])));

-- catalog_sha256 f2f1fd733b280690a6ce05b9f88b914760498f0ac85432fb64ecd1d6723f8b77

ALTER TABLE private.collection_pipeline_flags ADD CONSTRAINT "collection_pipeline_flags_pkey" PRIMARY KEY (flag_name);

-- catalog_sha256 20ec9db7a4e3b0f97cf714593ba0b5bb2c699e768195be9f3d77980a8bfe66f5

ALTER TABLE private.collection_projection_recovery_audit ADD CONSTRAINT "collection_projection_recovery_audit_pkey" PRIMARY KEY (run_id, outbox_id);

-- catalog_sha256 3dbbbacb9103331fd6d38deaed48c767eee0d8f5d3be616560bf2bd4356797d9

ALTER TABLE private.collection_projection_recovery_audit ADD CONSTRAINT "collection_projection_recovery_status_check" CHECK ((status = ANY (ARRAY['requeued'::text, 'skipped'::text])));

-- catalog_sha256 961552d2d819d3f8044a4866ebb6eee10ffebb4ee18767c091da5ad97408213a

ALTER TABLE private.collection_projection_trigger_registry ADD CONSTRAINT "collection_projection_trigger_registry_pkey" PRIMARY KEY (trigger_name);

-- catalog_sha256 557297c7af5bfd522f09d2478488ed24a4ca0a335038463b305f785e2e924c2e

ALTER TABLE private.collection_worker_heartbeats ADD CONSTRAINT "collection_worker_heartbeats_kind_check" CHECK ((worker_kind = ANY (ARRAY['decision'::text, 'projection'::text])));

-- catalog_sha256 54453bbf94b708e9e1cadfd6ec7f4fe530e093f9792b59fde27a157b15cb6cff

ALTER TABLE private.collection_worker_heartbeats ADD CONSTRAINT "collection_worker_heartbeats_pkey" PRIMARY KEY (worker_id);

-- catalog_sha256 c83b1ba62fad72f6713811d4e6f5741fda9b7de4753330f227d9e54aa8228365

ALTER TABLE private.collection_worker_leases_v3 ADD CONSTRAINT "collection_worker_leases_v3_kind_check" CHECK ((worker_kind = ANY (ARRAY['decision'::text, 'projection'::text])));

-- catalog_sha256 aff3c8d68281cb36b72c9e2f55776ed6cc109414e92da3b46463e7c28a5b86e6

ALTER TABLE private.collection_worker_leases_v3 ADD CONSTRAINT "collection_worker_leases_v3_owner_check" CHECK (((length(btrim(lease_owner)) >= 1) AND (length(btrim(lease_owner)) <= 160)));

-- catalog_sha256 0b900c1151f07b8cec94441ef86aeb7d4f04df150b22ebd05fb16081438dab20

ALTER TABLE private.collection_worker_leases_v3 ADD CONSTRAINT "collection_worker_leases_v3_pkey" PRIMARY KEY (worker_kind);

-- catalog_sha256 a32e2aa88b2df452dbf31e1c4c15d523417268336d9c282ca4d1fc66cb25c611

ALTER TABLE public.app_schema_releases ADD CONSTRAINT "app_schema_releases_pkey" PRIMARY KEY (version);

-- catalog_sha256 fde4a54df3d47cbadce2040953654e89896e5eca588ef8bc5a58741cb48240d0

ALTER TABLE public.audit_archive_manifests ADD CONSTRAINT "audit_archive_manifests_object_size_bytes_check" CHECK ((object_size_bytes > 0));

-- catalog_sha256 ad5fc766ee9d204dec6e40c3b8521aeaf76cf17242eda3a3b20f2de0639b1c3f

ALTER TABLE public.audit_archive_manifests ADD CONSTRAINT "audit_archive_manifests_pkey" PRIMARY KEY (id);

-- catalog_sha256 0366eca00d75f08d0dad03a4486dbfbf3c64a626e1debbe884f86cc8bdcb90f1

ALTER TABLE public.audit_archive_manifests ADD CONSTRAINT "audit_archive_manifests_row_count_check" CHECK ((row_count > 0));

-- catalog_sha256 50760b4b18f8cdaabc4787e6f87076c0a65a5d9af64090e1828e8b2222145dc6

ALTER TABLE public.audit_archive_manifests ADD CONSTRAINT "audit_archive_manifests_sha256_check" CHECK ((sha256 ~ '^[0-9a-f]{64}$'::text));

-- catalog_sha256 3812efa07c883806cd71fed888b2880711402ab9b949f13df2b7f4224a5896a7

ALTER TABLE public.audit_archive_manifests ADD CONSTRAINT "audit_archive_manifests_status_check" CHECK ((status = ANY (ARRAY['verified'::text, 'purged'::text, 'expired'::text, 'error'::text])));

-- catalog_sha256 c09c68326c22c7a8c8bbc22ea9510fbbdf8a5b606994a9417ba9fd0eee5a23bb

ALTER TABLE public.audit_archive_manifests ADD CONSTRAINT "audit_archive_manifests_storage_path_key" UNIQUE (storage_path);

-- catalog_sha256 518f525432e54795a1d7109dd2288ca001c4f0d1800aaa9888ea7a11cee8c1c4

ALTER TABLE public.coletas_producao ADD CONSTRAINT "coletas_producao_batch_sequence_check" CHECK ((batch_sequence >= 0));

-- catalog_sha256 2267d6da9ebdfa7892747c065b9e53d3765d637b89a105dcf3ca4c8f6a04c0cb

ALTER TABLE public.coletas_producao ADD CONSTRAINT "coletas_producao_client_event_id_check" CHECK ((btrim(client_event_id) <> ''::text));

-- catalog_sha256 dc2bc9c3f48868aff3401ed582268d52ee07bc4ed756f249bed5825d4743be60

ALTER TABLE public.coletas_producao ADD CONSTRAINT "coletas_producao_client_event_id_key" UNIQUE (client_event_id);

-- catalog_sha256 f1132d5ec528cd78e79d5568d97713fe924dc6cce352156d02ca736a1812f827

ALTER TABLE public.coletas_producao ADD CONSTRAINT "coletas_producao_device_sequence_check" CHECK (((device_sequence IS NULL) OR (device_sequence > 0))) NOT VALID;

-- catalog_sha256 a4dc713ec201c8c3b0b881e995d4298f9f66d1892831b4b81ab03667a7739353

ALTER TABLE public.coletas_producao ADD CONSTRAINT "coletas_producao_event_kind_check" CHECK ((event_kind = 'production_stage'::text));

-- catalog_sha256 e6a501a19df505059a4dd8daf9f0b013f4aa85623f2bda7d5b701f959e52a025

ALTER TABLE public.coletas_producao ADD CONSTRAINT "coletas_producao_pipeline_version_check" CHECK ((pipeline_version = ANY (ARRAY[2, 3]))) NOT VALID;

-- catalog_sha256 98fbbec448e604559f112b4b46d881aeca3ad87adaea2f3e7d432ae3e29e8ee8

ALTER TABLE public.coletas_producao ADD CONSTRAINT "coletas_producao_pkey" PRIMARY KEY (id);

-- catalog_sha256 083a57fb7e0986e6f9c3e4fe682c008963d89c7d7fce0a54717d6602b4cec2da

ALTER TABLE public.coletas_producao ADD CONSTRAINT "coletas_producao_source_mode_check" CHECK ((source_mode = ANY (ARRAY['live'::text, 'offline_replay'::text]))) NOT VALID;

-- catalog_sha256 cd81eb142bee82f94fafcafd10754c522cab62826839a82a97761d6e1fa2e42a

ALTER TABLE public.coletas_producao ADD CONSTRAINT "coletas_producao_status_check" CHECK ((status_sincronizacao = ANY (ARRAY['recebida'::text, 'processando'::text, 'sincronizada'::text, 'erro'::text])));

-- catalog_sha256 2d917756141fb9801ec484b5cb5a3182b3358897e9db26ba71b4334f1eb4f2fd

ALTER TABLE public.coletas_producao ADD CONSTRAINT "coletas_producao_tag_lida_check" CHECK ((btrim(tag_lida) <> ''::text));

-- catalog_sha256 6bb2b3f9d42e11800824b2ebb2e3a8bd8597ded90e1ddbcf532b6dd687ddfe5b

ALTER TABLE public.collection_processing_attempts ADD CONSTRAINT "collection_processing_attempts_number_check" CHECK ((attempt_number > 0));

-- catalog_sha256 1753e1c97d7828e38e9b05bb8013e45abbb4059e9315041e55bc3cb4e99f7aba

ALTER TABLE public.collection_processing_attempts ADD CONSTRAINT "collection_processing_attempts_pkey" PRIMARY KEY (id);

-- catalog_sha256 7406831d7baf2972f9b0440d63bd17c29a99294e0e566fda8af3cb2164dda491

ALTER TABLE public.collection_processing_attempts ADD CONSTRAINT "collection_processing_attempts_unique" UNIQUE (client_event_id, attempt_number);

-- catalog_sha256 26a70aa77bdaae789fe699ea15d3e65fdd6a26480a5a8516098eef5f687a91ab

ALTER TABLE public.collection_projection_applied ADD CONSTRAINT "collection_projection_applied_pkey" PRIMARY KEY (outbox_id, projection_type);

-- catalog_sha256 4594435119013893248d12092fe95e4fd717ad072172f3d9df09fcf26f707c8c

ALTER TABLE public.collection_projection_outbox ADD CONSTRAINT "collection_projection_outbox_decision_check" CHECK ((decision = ANY (ARRAY['approved'::text, 'rejected'::text, 'blocked'::text, 'duplicated'::text, 'pending_review'::text])));

-- catalog_sha256 0f90510c13572e3e3346937009e85bf5d0c58160e60c8cdd51913b66ee4eb502

ALTER TABLE public.collection_projection_outbox ADD CONSTRAINT "collection_projection_outbox_event_revision_unique" UNIQUE (client_event_id, projection_revision);

-- catalog_sha256 ce34a083d53fdab2df1f5530c04ea0da3fdd091103123e34948ef16ada257391

ALTER TABLE public.collection_projection_outbox ADD CONSTRAINT "collection_projection_outbox_kind_check" CHECK ((projection_kind = ANY (ARRAY['decision'::text, 'correction'::text])));

-- catalog_sha256 e23352ca54838cca701fd0cd1bc0b2f2961355d0b713f798fb54b6d2cc1d052a

ALTER TABLE public.collection_projection_outbox ADD CONSTRAINT "collection_projection_outbox_pkey" PRIMARY KEY (id);

-- catalog_sha256 2272bce86947de50a0990dffa9c853bec94550b831056f2259201fbb020cbdc2

ALTER TABLE public.collection_projection_outbox ADD CONSTRAINT "collection_projection_outbox_previous_decision_check" CHECK (((previous_decision IS NULL) OR (previous_decision = ANY (ARRAY['approved'::text, 'rejected'::text, 'blocked'::text, 'duplicated'::text, 'pending_review'::text]))));

-- catalog_sha256 c6ea813e2046dc775f6d1bf3d03b7d1b642d9ae7c3945a06bbb863cab5fc3483

ALTER TABLE public.collection_projection_outbox ADD CONSTRAINT "collection_projection_outbox_quantity_check" CHECK ((quantity > 0));

-- catalog_sha256 17d3deff6c1b4641c7c57d8917590a95e8171ed88e19aaee0d98e93b7043b2a7

ALTER TABLE public.collection_projection_outbox ADD CONSTRAINT "collection_projection_outbox_revision_check" CHECK ((projection_revision >= 0));

-- catalog_sha256 f9c441ef5719c417c9d1f95488dbc70b0241abf6fa9b1864778ef27c326c7709

ALTER TABLE public.pcp_import_chunks ADD CONSTRAINT "pcp_import_chunks_batch_id_chunk_number_key" UNIQUE (batch_id, chunk_number);

-- catalog_sha256 d8ed9b644514146bfacebe154cbde05a5fd6e42afcf819fdc7ed5cb37af58dc4

ALTER TABLE public.pcp_import_chunks ADD CONSTRAINT "pcp_import_chunks_batch_id_source_line_key" UNIQUE (batch_id, source_line);

-- catalog_sha256 e257e398e2ca15c6800023e8a3f148b2cf5bff41cdf170c9a82b6f2a6ede15ef

ALTER TABLE public.pcp_import_chunks ADD CONSTRAINT "pcp_import_chunks_check" CHECK (((total_chunks > 0) AND (chunk_number <= total_chunks)));

-- catalog_sha256 dd17e766ddefe4affb6a8be158e41f9da9f368f6ebac1fc0c12ad5aef9760db6

ALTER TABLE public.pcp_import_chunks ADD CONSTRAINT "pcp_import_chunks_check1" CHECK ((last_source_line >= source_line));

-- catalog_sha256 05ec9e9bec07a787ce9cc50b4eded107f1cb1c66a226cb5f89294b51d217c1b3

ALTER TABLE public.pcp_import_chunks ADD CONSTRAINT "pcp_import_chunks_chunk_number_check" CHECK ((chunk_number > 0));

-- catalog_sha256 06ad2c396fc2e1f5646f398e56383cebbddc3d94d37b7f33680a5b73bd7758d0

ALTER TABLE public.pcp_import_chunks ADD CONSTRAINT "pcp_import_chunks_pkey" PRIMARY KEY (id);

-- catalog_sha256 70487ea9f892a0dc23c06f494efe84a978685256b4cabe47088d08a94bf3d64b

ALTER TABLE public.pcp_import_chunks ADD CONSTRAINT "pcp_import_chunks_retry_count_check" CHECK ((retry_count >= 0));

-- catalog_sha256 1ebb03642a2b24a2248d96475608ced4591f901f2499913a356aea020524a37e

ALTER TABLE public.pcp_import_chunks ADD CONSTRAINT "pcp_import_chunks_row_count_check" CHECK ((row_count > 0));

-- catalog_sha256 4bd876479c40d755eb8fe35ba2f20372f8975f748941036a94fe341c9f71157c

ALTER TABLE public.pcp_import_chunks ADD CONSTRAINT "pcp_import_chunks_row_hash_check" CHECK ((length(row_hash) = 64));

-- catalog_sha256 59ad4f36b5eed4c36a8f1cab7fd886cd2c6a6d3f7a24da25e64dc7c9972b953e

ALTER TABLE public.pcp_import_chunks ADD CONSTRAINT "pcp_import_chunks_source_line_check" CHECK ((source_line > 0));

-- catalog_sha256 0972547b115976a419a4b61feb6948272d020fc3dea042ae5dadf6ff04bd13b4

ALTER TABLE public.pcp_import_chunks ADD CONSTRAINT "pcp_import_chunks_status_check" CHECK ((status = ANY (ARRAY['pending'::text, 'upload_verified'::text, 'processing'::text, 'processed'::text, 'error'::text])));

-- catalog_sha256 6434c730e2ba4fa596558e462d7fa677899b14b5eaacbd6d350a67e5c663a5bb

ALTER TABLE public.pcp_import_manifests ADD CONSTRAINT "pcp_import_manifests_batch_id_key" UNIQUE (batch_id);

-- catalog_sha256 eac3c59203a756d8268e0d83e6e2ee9f38af97291c0309ec00d0a6fe53ceaa3a

ALTER TABLE public.pcp_import_manifests ADD CONSTRAINT "pcp_import_manifests_chunks_count_check" CHECK ((chunks_count >= 0));

-- catalog_sha256 c0c20c51d4968db8a1d131d5e626e709b0f410be99bf104a3a7420d6c7735878

ALTER TABLE public.pcp_import_manifests ADD CONSTRAINT "pcp_import_manifests_manifest_sha256_check" CHECK ((length(manifest_sha256) = 64));

-- catalog_sha256 912eb68833c4874ea64de8cf90f5b8957a7d525111f8dca91684c3389d0dacf9

ALTER TABLE public.pcp_import_manifests ADD CONSTRAINT "pcp_import_manifests_normalized_sha256_check" CHECK ((length(normalized_sha256) = 64));

-- catalog_sha256 41913dd4b53e9f56a7141d8e68f3acfad9d34ee3fe432a607e991ec706d6cc8e

ALTER TABLE public.pcp_import_manifests ADD CONSTRAINT "pcp_import_manifests_original_sha256_check" CHECK ((length(original_sha256) = 64));

-- catalog_sha256 3b7d3e3b815a569c096fab8f2d593495ffcab949d2dffa6b76d3d4cf77326336

ALTER TABLE public.pcp_import_manifests ADD CONSTRAINT "pcp_import_manifests_pkey" PRIMARY KEY (id);

-- catalog_sha256 4433e712d22e04594ee87ee976ac45497a0adb770fa86659e626b40c2c28269b

ALTER TABLE public.pcp_import_manifests ADD CONSTRAINT "pcp_import_manifests_rows_count_check" CHECK ((rows_count >= 0));

-- catalog_sha256 4f381b7768d5147df10bcfe65fb391e4678413219edfb7b61887ab6af10031a2

ALTER TABLE public.pcp_import_manifests ADD CONSTRAINT "pcp_import_manifests_source_size_check" CHECK ((source_size >= 0));

-- catalog_sha256 844f9ee3bfe652388f67353603ec028240ebe0542cadac0e995cd4c8b7eb6eba

ALTER TABLE public.pcp_import_manifests ADD CONSTRAINT "pcp_import_manifests_status_check" CHECK ((status = ANY (ARRAY['pending'::text, 'verified'::text, 'error'::text, 'expired'::text])));

-- catalog_sha256 15bfdaae7d5c3dcb0aaa9dee7eacaf126cd188ae9587038512d61eddf4e53049

ALTER TABLE public.production_archive_jobs ADD CONSTRAINT "production_archive_jobs_lot_id_key" UNIQUE (lot_id);

-- catalog_sha256 78172c0bb00f00e408f0ca7edbe78578ef5d619d1a48cbcee7eaef70a6b3a71d

ALTER TABLE public.production_archive_jobs ADD CONSTRAINT "production_archive_jobs_pkey" PRIMARY KEY (id);

-- catalog_sha256 60d9fa8400d7a17084bb5507d030dc8895fac0da1f59783b354bc25406a03151

ALTER TABLE public.production_archive_jobs ADD CONSTRAINT "production_archive_jobs_status_check" CHECK ((status = ANY (ARRAY['pending'::text, 'processing'::text, 'archived'::text, 'purged'::text, 'failed'::text])));

-- catalog_sha256 286e645319a444e01efd9d4024747e48323b1d4e5056c099ae178fde51391ff3

ALTER TABLE public.production_archive_manifests ADD CONSTRAINT "production_archive_manifests_job_id_key" UNIQUE (job_id);

-- catalog_sha256 7c4de7ec98434b9783e97ea22eef76212bb44ba235d33ed8647b3b32ae832ee2

ALTER TABLE public.production_archive_manifests ADD CONSTRAINT "production_archive_manifests_lot_id_key" UNIQUE (lot_id);

-- catalog_sha256 53d7bedba758da357b819a610fa34d8c6a9827a882a841b89e0c8ee54e3e3f3e

ALTER TABLE public.production_archive_manifests ADD CONSTRAINT "production_archive_manifests_object_size_bytes_check" CHECK ((object_size_bytes > 0));

-- catalog_sha256 44e937e7156f25f32bf024daaf1698d2cf4d0f8ad63aa996954fdb8896be3c43

ALTER TABLE public.production_archive_manifests ADD CONSTRAINT "production_archive_manifests_pkey" PRIMARY KEY (id);

-- catalog_sha256 e5f861bab7f042d1aa6caa3e1f9ad49286b1ce9f6e689fa0632d7ce9d5152f64

ALTER TABLE public.production_archive_manifests ADD CONSTRAINT "production_archive_manifests_sha256" CHECK ((sha256 ~ '^[0-9a-f]{64}$'::text));

-- catalog_sha256 dd3d0f7298749c64fc8f482c6e0d6267e3ea811af5f852b04237f91214ae1fd1

ALTER TABLE public.production_archive_manifests ADD CONSTRAINT "production_archive_manifests_status_check" CHECK ((status = ANY (ARRAY['verified'::text, 'purged'::text, 'expired'::text, 'error'::text])));

-- catalog_sha256 8ae1e4b6ab400a33be0d894e20eac52cb2118e913b6712b07acae58fc82a0c53

ALTER TABLE public.production_archive_manifests ADD CONSTRAINT "production_archive_manifests_storage_path_key" UNIQUE (storage_path);

-- catalog_sha256 5f14cdf68b920852a5d1cd05d20d063c432863b4bc14750f5658c96b15cd62f2

ALTER TABLE public.production_cell_active_contexts ADD CONSTRAINT "production_cell_active_contexts_pkey" PRIMARY KEY (id);

-- catalog_sha256 dfb30b70766c4b6f1a025a63cb059769490cc06fccc2c0d2f446c6d3f52772bd

ALTER TABLE public.production_cell_active_contexts ADD CONSTRAINT "production_cell_active_contexts_state_version_check" CHECK ((state_version > 0));

-- catalog_sha256 a73ec9a13629b36ffeec07e7590e437bf5106f9e5b9b2140e3589b497a027d03

ALTER TABLE public.production_cell_lot_states ADD CONSTRAINT "production_cell_lot_states_approved_count_check" CHECK ((approved_count >= 0));

-- catalog_sha256 373b6d3532c80e4a532d7f72f35ff920c841f226e1f47eded4995b63b7ada542

ALTER TABLE public.production_cell_lot_states ADD CONSTRAINT "production_cell_lot_states_expected_count_check" CHECK ((expected_count >= 0));

-- catalog_sha256 4a2f8e74eaabe5e726c06c2071cc0e829b4bbbb319b061c25e2843b5786d079e

ALTER TABLE public.production_cell_lot_states ADD CONSTRAINT "production_cell_lot_states_pending_count_check" CHECK ((pending_count >= 0));

-- catalog_sha256 75cb6851393f4b0eec2d16877d510595770053c3c3633df8ee9b69b631068478

ALTER TABLE public.production_cell_lot_states ADD CONSTRAINT "production_cell_lot_states_pkey" PRIMARY KEY (id);

-- catalog_sha256 0c6a1eb570606552bf5eec2a24a4d0c6b3145bce0d192f60f7367bd3e1e3473c

ALTER TABLE public.production_cell_lot_states ADD CONSTRAINT "production_cell_lot_states_rejected_count_check" CHECK ((rejected_count >= 0));

-- catalog_sha256 b0508d2352aae3a78041ceafc2441a5bffb2cb42d8f80e703c2dbce9da86030b

ALTER TABLE public.production_cell_lot_states ADD CONSTRAINT "production_cell_lot_states_replacement_count_check" CHECK ((replacement_count >= 0));

-- catalog_sha256 ea4123848d505fad99b30c6c49f193282187474b776d981dc6cda2afae286ff7

ALTER TABLE public.production_cell_lot_states ADD CONSTRAINT "production_cell_lot_states_rework_count_check" CHECK ((rework_count >= 0));

-- catalog_sha256 26dd05717fa19e583d1038daaa33a47ad9757f1849c4dffbc744164d8c7f9f84

ALTER TABLE public.production_cell_lot_states ADD CONSTRAINT "production_cell_lot_states_state_version_check" CHECK ((state_version > 0));

-- catalog_sha256 f7f5fe465759f7da3093245874b788d9f91eeaf4de7ada23d33fd9f25c07fb4e

ALTER TABLE public.production_cell_lot_states ADD CONSTRAINT "production_cell_lot_states_status_check" CHECK ((status = ANY (ARRAY['active'::text, 'paused'::text, 'closed'::text, 'cancelled'::text])));

-- catalog_sha256 6952abeeece25b1523ce4f958cfbf62d87c560af655a4c9d5b41b88e18ad6015

ALTER TABLE public.production_lot_stage_aggregates ADD CONSTRAINT "production_lot_stage_aggregates_approved_nonnegative" CHECK ((approved_count >= 0));

-- catalog_sha256 4870e4b82d77da16e2a0146a94b524c84ace9f9b2f5a9b9db7393814e544f737

ALTER TABLE public.production_lot_stage_aggregates ADD CONSTRAINT "production_lot_stage_aggregates_pkey" PRIMARY KEY (lot_id, step_code);

-- catalog_sha256 7716cdf7fe1dfbc6390009bf0a61754cafb58e078ee4020a1ed1fd00f65969b7

ALTER TABLE public.production_lot_stage_counter_shards ADD CONSTRAINT "production_lot_stage_counter_shards_number_check" CHECK (((shard_number >= 0) AND (shard_number < 32)));

-- catalog_sha256 1081546aada853b4d53db3a6a3aaf8c79889e83bae4bd1491eb0ace5f338d670

ALTER TABLE public.production_lot_stage_counter_shards ADD CONSTRAINT "production_lot_stage_counter_shards_pkey" PRIMARY KEY (lot_id, step_code, shard_number);

-- catalog_sha256 ac2d56a257b220f3d9220430db22c9df00d4e1ac9d836f5898cb3a91c47e5b39

ALTER TABLE public.promob_trusted_origins ADD CONSTRAINT "promob_trusted_origins_https_origin" CHECK ((origin ~ '^https://[A-Za-z0-9.-]+(:443)?$'::text));

-- catalog_sha256 309a75c0c90a056ed7bcbc1f54bc6e6beb51d9f09770ec24ca56a66f5fc36116

ALTER TABLE public.promob_trusted_origins ADD CONSTRAINT "promob_trusted_origins_pkey" PRIMARY KEY (origin);

-- catalog_sha256 d92d659c14077ff719254153e3810021a52575e41e21b43ac40c89325971f144

ALTER TABLE public.replacement_action_audit_logs ADD CONSTRAINT "replacement_action_audit_logs_action_check" CHECK ((action = ANY (ARRAY['approved_for_production'::text, 'force_completed'::text, 'cancelled'::text, 'released'::text])));

-- catalog_sha256 f5d48a0472d1169a6a83f9239a06a37eac9b63ca50c7864b0ae832f6ee2c16fd

ALTER TABLE public.replacement_action_audit_logs ADD CONSTRAINT "replacement_action_audit_logs_pkey" PRIMARY KEY (id);

-- catalog_sha256 bed4e820e0b9fbe134c050313c2492b4e490aa7c87995b2ae2ca2113f186adbe

ALTER TABLE private.coleta_producao_credentials ADD CONSTRAINT "coleta_producao_credentials_coleta_fk" FOREIGN KEY (coleta_id) REFERENCES public.coletas_producao(id) ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED;

-- catalog_sha256 13094c96bbd2a77350db519dfa09db6bd2019a1a6f194ef070f7d1ac7d45f304

ALTER TABLE private.collection_pipeline_flags ADD CONSTRAINT "collection_pipeline_flags_updated_by_fkey" FOREIGN KEY (updated_by) REFERENCES auth.users(id) ON DELETE SET NULL;

-- catalog_sha256 968a4fa089dd23052bbbfc9da356a9fac25c73e8fe1e071fa40d11b386a9a10a

ALTER TABLE public.coletas_producao ADD CONSTRAINT "coletas_producao_cell_id_fkey" FOREIGN KEY (cell_id) REFERENCES public.cells(id) ON DELETE SET NULL;

-- catalog_sha256 1b810211b94db4e6ff2c54359d5dbceb07ca232861c25b427e63940795a02845

ALTER TABLE public.coletas_producao ADD CONSTRAINT "coletas_producao_machine_id_fkey" FOREIGN KEY (machine_id) REFERENCES public.production_machines(id) ON DELETE SET NULL;

-- catalog_sha256 bcc25bc904e885b2c286e26bb6441ad1735eff616d3347f22cc158c7f5454b24

ALTER TABLE public.coletas_producao ADD CONSTRAINT "coletas_producao_operator_id_fkey" FOREIGN KEY (operator_id) REFERENCES public.operators(id) ON DELETE SET NULL;

-- catalog_sha256 8492f8d7386137887e2376485c58c3a15d2ed4588910e5fb9705d2af62e491ac

ALTER TABLE public.coletas_producao ADD CONSTRAINT "coletas_producao_operator_session_id_fkey" FOREIGN KEY (operator_session_id) REFERENCES public.operator_sessions(id) ON DELETE SET NULL;

-- catalog_sha256 ac51c5c0d843df75defa3661680c71c72028da7b48ecf821ef6cc1191206a53b

ALTER TABLE public.collection_projection_applied ADD CONSTRAINT "collection_projection_applied_outbox_id_fkey" FOREIGN KEY (outbox_id) REFERENCES public.collection_projection_outbox(id) ON DELETE RESTRICT;

-- catalog_sha256 e641f9eef3187ccf7b4e094610070c48530b6bc61bfc6180122b7d750021aeeb

ALTER TABLE public.collection_projection_outbox ADD CONSTRAINT "collection_projection_outbox_cell_id_fkey" FOREIGN KEY (cell_id) REFERENCES public.cells(id) ON DELETE SET NULL;

-- catalog_sha256 7f8fe1aa99493e8a1052947a378693ac4894a57f1916655920c13ec2176edc78

ALTER TABLE public.collection_projection_outbox ADD CONSTRAINT "collection_projection_outbox_lot_id_fkey" FOREIGN KEY (lot_id) REFERENCES public.production_lots(id) ON DELETE RESTRICT;

-- catalog_sha256 5605f32cd038bbf80089efcd62459f39a078deb7d0e3d20815f25d5afe5b03b6

ALTER TABLE public.collection_projection_outbox ADD CONSTRAINT "collection_projection_outbox_machine_id_fkey" FOREIGN KEY (machine_id) REFERENCES public.production_machines(id) ON DELETE SET NULL;

-- catalog_sha256 fab7cf2abdf327d22e5f98394abc647b5b54e6f2494297a88416ec072a55624c

ALTER TABLE public.collection_projection_outbox ADD CONSTRAINT "collection_projection_outbox_operator_id_fkey" FOREIGN KEY (operator_id) REFERENCES public.operators(id) ON DELETE SET NULL;

-- catalog_sha256 8035671520659d82d6cda6c5a776978b6bab503dee4345b777fc84e96508c855

ALTER TABLE public.collection_projection_outbox ADD CONSTRAINT "collection_projection_outbox_piece_id_fkey" FOREIGN KEY (piece_id) REFERENCES public.production_pieces(id) ON DELETE RESTRICT;

-- catalog_sha256 29d9adf7d7d5f1a7ea34f4b321abdfce63f0532d37765a347d06d02cfb603394

ALTER TABLE public.collection_projection_outbox ADD CONSTRAINT "collection_projection_outbox_reading_id_fkey" FOREIGN KEY (reading_id) REFERENCES public.production_stage_readings(id) ON DELETE RESTRICT;

-- catalog_sha256 40b3b6a922469094009a9269f66dc3e06977ee3608deed2e93b300ba4a74ea46

ALTER TABLE public.pcp_import_chunks ADD CONSTRAINT "pcp_import_chunks_batch_id_fkey" FOREIGN KEY (batch_id) REFERENCES public.promob_import_batches(id) ON DELETE CASCADE;

-- catalog_sha256 1568cd8d02dc7bfd2a7dcb16030a495b1d44e7e2d98ba9788e45a8f94266b3e7

ALTER TABLE public.pcp_import_chunks ADD CONSTRAINT "pcp_import_chunks_created_by_fkey" FOREIGN KEY (created_by) REFERENCES auth.users(id);

-- catalog_sha256 fbacd1a8ec8afd90252837d7aab02cd49e9c79e1b2deaae0aa08493df717893a

ALTER TABLE public.pcp_import_manifests ADD CONSTRAINT "pcp_import_manifests_batch_id_fkey" FOREIGN KEY (batch_id) REFERENCES public.promob_import_batches(id) ON DELETE CASCADE;

-- catalog_sha256 4cb1aecdbbefb064d53a9853d1c4ea836036df5a705a5ec160b4068d732aa863

ALTER TABLE public.pcp_import_manifests ADD CONSTRAINT "pcp_import_manifests_created_by_fkey" FOREIGN KEY (created_by) REFERENCES auth.users(id);

-- catalog_sha256 0fb0ce97e508298c910f6f6f655b6efed5f0c0843c938aec951242367e100e83

ALTER TABLE public.production_archive_jobs ADD CONSTRAINT "production_archive_jobs_lot_id_fkey" FOREIGN KEY (lot_id) REFERENCES public.production_lots(id) ON DELETE CASCADE;

-- catalog_sha256 e4be6f2f6a0240ccd27433f50ce9270699be504f22711b64586159c20d9ec8b3

ALTER TABLE public.production_archive_manifests ADD CONSTRAINT "production_archive_manifests_job_id_fkey" FOREIGN KEY (job_id) REFERENCES public.production_archive_jobs(id) ON DELETE RESTRICT;

-- catalog_sha256 fd170fb045c02e0d51305a30368803b79328fb4f54ff4986943361174f370f8b

ALTER TABLE public.production_archive_manifests ADD CONSTRAINT "production_archive_manifests_lot_id_fkey" FOREIGN KEY (lot_id) REFERENCES public.production_lots(id) ON DELETE RESTRICT;

-- catalog_sha256 882115dd08e4c2ff2c8aba07f3bbb3205b0afd685c98936235fd8f6d96543613

ALTER TABLE public.production_cell_active_contexts ADD CONSTRAINT "production_cell_active_contexts_active_lot_id_fkey" FOREIGN KEY (active_lot_id) REFERENCES public.production_lots(id) ON DELETE SET NULL;

-- catalog_sha256 ce8647dbf1fb9d28511fb9e16afb2a131021754805711c9bacf7435c7e81150a

ALTER TABLE public.production_cell_active_contexts ADD CONSTRAINT "production_cell_active_contexts_active_pcp_import_batch_id_fkey" FOREIGN KEY (active_pcp_import_batch_id) REFERENCES public.promob_import_batches(id) ON DELETE SET NULL;

-- catalog_sha256 d73ef7f55aac4eb01ba2b3bf61333593d932b13b32167a12df4ea6e92380d940

ALTER TABLE public.production_cell_active_contexts ADD CONSTRAINT "production_cell_active_contexts_cell_id_fkey" FOREIGN KEY (cell_id) REFERENCES public.cells(id) ON DELETE SET NULL;

-- catalog_sha256 6b6879d4850964b9ff8a50f9bdd6abeb2d674bac4b652a2d1895c968582f2f0d

ALTER TABLE public.production_cell_active_contexts ADD CONSTRAINT "production_cell_active_contexts_machine_id_fkey" FOREIGN KEY (machine_id) REFERENCES public.production_machines(id) ON DELETE SET NULL;

-- catalog_sha256 00b8a0e5fff14d5e0647f80dd8c8f5f8a02e802f0ed230a3f7a3692a0c646f05

ALTER TABLE public.production_cell_lot_states ADD CONSTRAINT "production_cell_lot_states_cell_id_fkey" FOREIGN KEY (cell_id) REFERENCES public.cells(id) ON DELETE SET NULL;

-- catalog_sha256 3944b32b14c16bcd696ea9924e39c540969e2c88abb836895e1db57e82133cc2

ALTER TABLE public.production_cell_lot_states ADD CONSTRAINT "production_cell_lot_states_closed_by_operator_id_fkey" FOREIGN KEY (closed_by_operator_id) REFERENCES public.operators(id) ON DELETE SET NULL;

-- catalog_sha256 8bd9089c8c255c321084ea75cc4e58eb84bc9a2c04da1d6a96b0e7e935f6c0c3

ALTER TABLE public.production_cell_lot_states ADD CONSTRAINT "production_cell_lot_states_lot_id_fkey" FOREIGN KEY (lot_id) REFERENCES public.production_lots(id) ON DELETE CASCADE;

-- catalog_sha256 05dc9a7331109dc31dc51084f832f00a7aa66d1666edf57f1ce36b0cbfca57d7

ALTER TABLE public.production_cell_lot_states ADD CONSTRAINT "production_cell_lot_states_machine_id_fkey" FOREIGN KEY (machine_id) REFERENCES public.production_machines(id) ON DELETE SET NULL;

-- catalog_sha256 b50941d29698cc4eb958ab85ce7ff56c8cd5135abcc3c9c69094e5ce025bd06b

ALTER TABLE public.production_cell_lot_states ADD CONSTRAINT "production_cell_lot_states_pcp_import_batch_id_fkey" FOREIGN KEY (pcp_import_batch_id) REFERENCES public.promob_import_batches(id) ON DELETE SET NULL;

-- catalog_sha256 e08a6a6815a5c5d88f30ce32bbb7a4d654ab8de476d5595c27103c45e8b34eeb

ALTER TABLE public.production_lot_stage_aggregates ADD CONSTRAINT "production_lot_stage_aggregates_last_reading_id_fkey" FOREIGN KEY (last_reading_id) REFERENCES public.production_stage_readings(id) ON DELETE SET NULL;

-- catalog_sha256 8e30f54a685351dc7d70768268fa1ed1141bf96f0f0e547cb84744a1fc2bb346

ALTER TABLE public.production_lot_stage_aggregates ADD CONSTRAINT "production_lot_stage_aggregates_lot_id_fkey" FOREIGN KEY (lot_id) REFERENCES public.production_lots(id) ON DELETE CASCADE;

-- catalog_sha256 3befc318dfd604d1fe2e4f12ca00f76dda5bb661dc561a09f79edb72ab8688b2

ALTER TABLE public.production_lot_stage_counter_shards ADD CONSTRAINT "production_lot_stage_counter_shards_lot_id_fkey" FOREIGN KEY (lot_id) REFERENCES public.production_lots(id) ON DELETE RESTRICT;

-- catalog_sha256 4c42122e9eeeedace583dc20646b49dc22a3beb5b52d061ade13086f70e15df2

ALTER TABLE public.promob_trusted_origins ADD CONSTRAINT "promob_trusted_origins_created_by_fkey" FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;

-- catalog_sha256 4e41a0560f7d2b04d1031191967c35f27e0b87ab1a457c06bc4e59ddaa4f25a0

ALTER TABLE public.replacement_action_audit_logs ADD CONSTRAINT "replacement_action_audit_logs_original_piece_id_fkey" FOREIGN KEY (original_piece_id) REFERENCES public.production_pieces(id) ON DELETE SET NULL;

-- catalog_sha256 a387888c3acc5c8f7c2ce1badce223bb83e92fa191207043cd8c9293c2e943e5

ALTER TABLE public.replacement_action_audit_logs ADD CONSTRAINT "replacement_action_audit_logs_replacement_order_id_fkey" FOREIGN KEY (replacement_order_id) REFERENCES public.replacement_orders(id) ON DELETE CASCADE;

-- catalog_sha256 98a80d6b4e4f435c56189c3fdce2d574256219094c1099b41e0e3eebb9aab976

ALTER TABLE public.replacement_action_audit_logs ADD CONSTRAINT "replacement_action_audit_logs_replacement_piece_id_fkey" FOREIGN KEY (replacement_piece_id) REFERENCES public.production_pieces(id) ON DELETE SET NULL;

-- catalog_sha256 6ea85ae06a34c610e0d272b4514e950ddd0d78cf3ed9728c5700579790a185f4

CREATE UNIQUE INDEX uq_coletas_producao_device_sequence ON public.coletas_producao USING btree (device_id, device_sequence) WHERE ((device_id IS NOT NULL) AND (device_sequence IS NOT NULL));

-- catalog_sha256 1f0e200e28e898ae06d56ee23d458f2c93149013da2d654a5e9e0deeee6268e7

CREATE UNIQUE INDEX uq_production_cell_active_context_scope ON public.production_cell_active_contexts USING btree (lower(btrim(cell_name)), lower(btrim(step_code)), COALESCE(machine_id, '00000000-0000-0000-0000-000000000000'::uuid));

-- catalog_sha256 ccf41d3ac88668e42c30a7d1e1f08bbcf97761668ec7c884ee416d647ed624b6

CREATE UNIQUE INDEX uq_production_cell_lot_state_scope ON public.production_cell_lot_states USING btree (lot_id, lower(btrim(cell_name)), lower(btrim(step_code)), COALESCE(machine_id, '00000000-0000-0000-0000-000000000000'::uuid));

INSERT INTO private.collection_pipeline_flags (flag_name, enabled) VALUES
  ('collection_pipeline_v3_ingress',false),
  ('collection_pipeline_v3_worker',false),
  ('collection_pipeline_v3_projection',false),
  ('collection_pipeline_v3_broadcast',false);

CREATE TABLE private.mes_recovery_journal (recovery_key text PRIMARY KEY, target_ref text NOT NULL, selection_sha256 text NOT NULL, applied_at timestamptz NOT NULL DEFAULT clock_timestamp());

ALTER TABLE private.mes_recovery_journal ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE private.mes_recovery_journal FROM PUBLIC, anon, authenticated, service_role;

INSERT INTO private.mes_recovery_journal (recovery_key,target_ref,selection_sha256) VALUES ('collection_foundation_20260905','smnsihksrhzbkhcbdjfu','d740353826e364449dd765cf9d4589ca0c98623d0f453c13717d60281fee5ecc');
