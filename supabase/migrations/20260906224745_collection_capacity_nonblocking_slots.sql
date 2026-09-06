-- Slot ownership remains a persisted, expiring lease. Advisory try-locks only
-- coordinate attempts inside a transaction so occupied slot 1 cannot serialize
-- unrelated workers before they can inspect slots 2..N.
CREATE OR REPLACE FUNCTION private.try_acquire_collection_worker_slot_v3(
  p_worker_kind text,
  p_lease_owner text,
  p_ttl_seconds integer DEFAULT 45,
  p_max_slots integer DEFAULT 4
)
RETURNS smallint LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'pg_catalog', 'private', 'pg_temp'
AS $function$
DECLARE
  v_now timestamptz := clock_timestamp();
  v_owner text := left(btrim(coalesce(p_lease_owner, '')), 160);
  v_max_slots integer := greatest(1, least(coalesce(p_max_slots, 4), 16));
  v_slot smallint;
  v_candidate integer;
BEGIN
  IF p_worker_kind NOT IN ('decision', 'projection') OR v_owner = '' THEN
    RAISE EXCEPTION 'COLLECTION_WORKER_SLOT_INPUT_INVALID' USING ERRCODE = '22023';
  END IF;

  -- One lease owner cannot claim two slots through concurrent retries.
  IF NOT pg_try_advisory_xact_lock(hashtextextended(
    'acprod:v3:worker-owner:' || p_worker_kind || ':' || v_owner, 0
  )) THEN
    RETURN NULL;
  END IF;

  SELECT slot_number INTO v_slot FROM private.collection_worker_slots_v3
  WHERE worker_kind = p_worker_kind AND lease_owner = v_owner;
  IF FOUND THEN
    IF NOT pg_try_advisory_xact_lock(hashtextextended(
      'acprod:v3:worker-slot:' || p_worker_kind || ':' || v_slot::text, 0
    )) THEN
      RETURN NULL;
    END IF;
    UPDATE private.collection_worker_slots_v3
    SET heartbeat_at = v_now,
        expires_at = v_now + make_interval(secs => greatest(15, least(coalesce(p_ttl_seconds, 45), 120))),
        updated_at = v_now
    WHERE worker_kind = p_worker_kind AND slot_number = v_slot AND lease_owner = v_owner
    RETURNING slot_number INTO v_slot;
    IF FOUND THEN RETURN v_slot; END IF;
  END IF;

  FOR v_candidate IN 1..v_max_slots LOOP
    -- Do not even acquire a lock on a healthy lease owned by another worker.
    IF EXISTS (SELECT 1 FROM private.collection_worker_slots_v3
      WHERE worker_kind = p_worker_kind AND slot_number = v_candidate
        AND expires_at > v_now) THEN
      CONTINUE;
    END IF;
    BEGIN
      IF NOT pg_try_advisory_xact_lock(hashtextextended(
        'acprod:v3:worker-slot:' || p_worker_kind || ':' || v_candidate::text, 0
      )) THEN
        CONTINUE;
      END IF;
      v_slot := NULL;
      INSERT INTO private.collection_worker_slots_v3 (
        worker_kind, slot_number, lease_owner,
        acquired_at, heartbeat_at, expires_at, updated_at
      ) VALUES (
        p_worker_kind, v_candidate, v_owner, v_now, v_now,
        v_now + make_interval(secs => greatest(15, least(coalesce(p_ttl_seconds, 45), 120))), v_now
      )
      ON CONFLICT (worker_kind, slot_number) DO UPDATE
      SET lease_owner = excluded.lease_owner,
          acquired_at = excluded.acquired_at,
          heartbeat_at = excluded.heartbeat_at,
          expires_at = excluded.expires_at,
          updated_at = excluded.updated_at
      WHERE private.collection_worker_slots_v3.expires_at <= v_now
      RETURNING slot_number INTO v_slot;
      IF v_slot IS NOT NULL THEN RETURN v_slot; END IF;

      -- A lease may have renewed between the initial read and try-lock. Roll
      -- back this candidate subtransaction to release its unused lock before
      -- processing another slot for a potentially long worker transaction.
      RAISE EXCEPTION 'COLLECTION_WORKER_SLOT_RACED' USING ERRCODE = 'ZV301';
    EXCEPTION WHEN SQLSTATE 'ZV301' THEN
      CONTINUE;
    END;
  END LOOP;
  RETURN NULL;
END;
$function$;

CREATE OR REPLACE FUNCTION private.release_collection_worker_slot_v3(
  p_worker_kind text, p_lease_owner text
)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'pg_catalog', 'private', 'pg_temp'
AS $function$
DECLARE
  v_owner text := left(btrim(coalesce(p_lease_owner, '')), 160);
  v_slot smallint;
  v_rows integer;
BEGIN
  -- Same order as acquire: owner then slot. A duplicate/release request never
  -- waits on an in-flight worker; its lease will be released later or expire.
  IF NOT pg_try_advisory_xact_lock(hashtextextended(
    'acprod:v3:worker-owner:' || p_worker_kind || ':' || v_owner, 0
  )) THEN RETURN false; END IF;
  SELECT slot_number INTO v_slot FROM private.collection_worker_slots_v3
  WHERE worker_kind = p_worker_kind AND lease_owner = v_owner;
  IF NOT FOUND THEN RETURN false; END IF;
  IF NOT pg_try_advisory_xact_lock(hashtextextended(
    'acprod:v3:worker-slot:' || p_worker_kind || ':' || v_slot::text, 0
  )) THEN RETURN false; END IF;
  DELETE FROM private.collection_worker_slots_v3
  WHERE worker_kind = p_worker_kind AND slot_number = v_slot AND lease_owner = v_owner;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows = 1;
END;
$function$;

REVOKE ALL ON FUNCTION private.try_acquire_collection_worker_slot_v3(text, text, integer, integer)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.release_collection_worker_slot_v3(text, text)
  FROM PUBLIC, anon, authenticated, service_role;
