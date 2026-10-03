-- Activity Log V1.3A: isolated failed/system event foundation.
-- Additive only: no events are backfilled and no capability is enabled.
BEGIN;

DO $owner_guard$
BEGIN
  IF current_user <> 'postgres' THEN
    RAISE EXCEPTION 'Activity Log V1.3A must be installed as postgres'
      USING ERRCODE = '42501';
  END IF;
END
$owner_guard$;

-- Extend the existing target-scoped capability vocabulary. Missing rows still
-- mean disabled; this migration deliberately inserts no capability rows.
ALTER TABLE cms_private.resume_capabilities
  DROP CONSTRAINT resume_capabilities_capability_key_check;
ALTER TABLE cms_private.resume_capabilities
  ADD CONSTRAINT resume_capabilities_capability_key_check
  CHECK (capability_key IN ('activity_log', 'activity_log_system_events'));

CREATE TABLE cms_private.activity_log_system_events (
  event_id uuid PRIMARY KEY,
  occurred_at timestamptz NOT NULL,
  resume_id uuid NOT NULL,
  site_key_snapshot text NOT NULL CHECK (site_key_snapshot IN ('example-cv', 'example-cv-qa')),
  actor_user_id uuid,
  actor_email_snapshot text CHECK (
    actor_email_snapshot IS NULL OR pg_catalog.octet_length(actor_email_snapshot) <= 320
  ),
  actor_role_snapshot text CHECK (actor_role_snapshot IS NULL OR actor_role_snapshot IN ('owner', 'qa')),
  event_kind text NOT NULL CHECK (event_kind IN ('operation_failure', 'system_change')),
  outcome text NOT NULL CHECK (outcome IN ('rejected', 'applied')),
  section_key text CHECK (section_key IS NULL OR section_key IN (
    'introduction', 'education', 'experience', 'awards', 'skills',
    'contact', 'projects', 'website_links', 'profile', 'files'
  )),
  operation text CHECK (operation IS NULL OR operation IN (
    'create', 'update', 'delete', 'reorder', 'upload', 'remove'
  )),
  failure_stage text,
  failure_code text,
  system_event_key text,
  request_id uuid,
  ip_network cidr,
  country_code text CHECK (
    country_code IS NULL OR country_code COLLATE pg_catalog."C" ~ '^[A-Z]{2}$'
  ),
  region text CHECK (
    region IS NULL OR (pg_catalog.octet_length(region) BETWEEN 1 AND 128 AND region !~ '[[:cntrl:]]')
  ),
  city text CHECK (
    city IS NULL OR (pg_catalog.octet_length(city) BETWEEN 1 AND 128 AND city !~ '[[:cntrl:]]')
  ),
  CONSTRAINT activity_log_system_event_ip_prefix_check CHECK (
    ip_network IS NULL OR
    (pg_catalog.family(ip_network) = 4 AND pg_catalog.masklen(ip_network) = 24) OR
    (pg_catalog.family(ip_network) = 6 AND pg_catalog.masklen(ip_network) = 48)
  ),
  CONSTRAINT activity_log_system_event_kind_check CHECK (
    (
      event_kind = 'operation_failure'
      AND outcome = 'rejected'
      AND section_key = 'introduction'
      AND operation = 'update'
      AND failure_stage IS NOT NULL
      AND failure_stage IN (
        'trusted_context_validation', 'database_validation',
        'idempotency', 'write_configuration'
      )
      AND failure_code IS NOT NULL
      AND failure_code IN (
        'trusted_context_rejected', 'business_validation_rejected',
        'idempotency_conflict', 'authorized_write_configuration_rejected'
      )
      AND system_event_key IS NULL
      AND actor_user_id IS NOT NULL
      AND actor_role_snapshot IS NOT NULL
      AND request_id IS NOT NULL
    ) OR (
      event_kind = 'system_change'
      AND outcome = 'applied'
      AND section_key IS NULL
      AND operation IS NULL
      AND failure_stage IS NULL
      AND failure_code IS NULL
      AND system_event_key IS NOT NULL
      AND system_event_key IN ('resume_published', 'resume_unpublished')
    )
  ),
  CONSTRAINT activity_log_system_event_failure_pair_check CHECK (
    event_kind <> 'operation_failure' OR
    (failure_stage = 'trusted_context_validation' AND failure_code = 'trusted_context_rejected') OR
    (failure_stage = 'database_validation' AND failure_code = 'business_validation_rejected') OR
    (failure_stage = 'idempotency' AND failure_code = 'idempotency_conflict') OR
    (failure_stage = 'write_configuration' AND failure_code = 'authorized_write_configuration_rejected')
  )
);

CREATE INDEX activity_log_system_events_target_cursor_idx
  ON cms_private.activity_log_system_events (resume_id, occurred_at DESC, event_id DESC);
CREATE INDEX activity_log_system_events_target_request_idx
  ON cms_private.activity_log_system_events (resume_id, request_id)
  WHERE request_id IS NOT NULL;

ALTER TABLE cms_private.activity_log_system_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE cms_private.activity_log_system_events
  FROM PUBLIC, anon, authenticated, service_role, pg_write_all_data;

CREATE FUNCTION cms_private.reject_activity_log_system_event_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $function$
BEGIN
  RAISE EXCEPTION 'Activity Log system events are immutable' USING ERRCODE = '55000';
END
$function$;

CREATE TRIGGER activity_log_system_events_no_row_mutation
  BEFORE UPDATE OR DELETE ON cms_private.activity_log_system_events
  FOR EACH ROW EXECUTE FUNCTION cms_private.reject_activity_log_system_event_mutation();
CREATE TRIGGER activity_log_system_events_no_truncate
  BEFORE TRUNCATE ON cms_private.activity_log_system_events
  FOR EACH STATEMENT EXECUTE FUNCTION cms_private.reject_activity_log_system_event_mutation();
REVOKE ALL ON FUNCTION cms_private.reject_activity_log_system_event_mutation()
  FROM PUBLIC, anon, authenticated, service_role;

-- V1.3 uses an independent key-id/Vault-name namespace and never creates the
-- production secret. Failures, malformed values and Vault errors are generic.
CREATE FUNCTION cms_private.activity_log_v13_key(target_key_id text)
RETURNS bytea
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  decrypted_value text;
  decoded_value bytea;
BEGIN
  IF target_key_id IS DISTINCT FROM 'activity_log_v13_failure_v1' THEN
    RAISE EXCEPTION 'Invalid signed system event' USING ERRCODE = '22023';
  END IF;

  SELECT secret.decrypted_secret
    INTO STRICT decrypted_value
    FROM vault.decrypted_secrets AS secret
    WHERE secret.name = 'activity_log_v13_failure_v1';

  IF decrypted_value IS NULL
    OR pg_catalog.char_length(decrypted_value) <> 64
    OR (decrypted_value COLLATE pg_catalog."C") !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'Invalid signed system event' USING ERRCODE = '22023';
  END IF;

  decoded_value := pg_catalog.decode(decrypted_value, 'hex');
  IF pg_catalog.octet_length(decoded_value) <> 32 THEN
    RAISE EXCEPTION 'Invalid signed system event' USING ERRCODE = '22023';
  END IF;
  RETURN decoded_value;
EXCEPTION
  WHEN OTHERS THEN
    -- PostgreSQL's special query-cancel/assert-failure classes are not caught
    -- by WHEN OTHERS; all ordinary provider/decode failures stay generic.
    RAISE EXCEPTION 'Invalid signed system event' USING ERRCODE = '22023';
END
$function$;
REVOKE ALL ON FUNCTION cms_private.activity_log_v13_key(text)
  FROM PUBLIC, anon, authenticated, service_role;

-- Target authorization does not consult either Activity Log capability. The
-- recorder checks its capture capability separately after target scope.
CREATE FUNCTION cms_private.assert_activity_log_system_event_target(target_resume_id uuid)
RETURNS TABLE (resolved_site_key text, resolved_role text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  caller_role text;
  caller_resume_id uuid;
BEGIN
  IF (SELECT auth.uid()) IS NULL THEN
    RAISE EXCEPTION 'Activity Log access denied' USING ERRCODE = '42501';
  END IF;

  SELECT admin.role, admin.resume_id
    INTO caller_role, caller_resume_id
    FROM public.cms_admins AS admin
    WHERE admin.user_id = (SELECT auth.uid());
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Activity Log access denied' USING ERRCODE = '42501';
  END IF;

  IF caller_role = 'owner' AND caller_resume_id IS NULL THEN
    SELECT site.site_key INTO resolved_site_key
      FROM public.resume_sites AS site
      WHERE site.id = target_resume_id
        AND site.site_key IN ('example-cv', 'example-cv-qa')
        AND (site.site_key <> 'example-cv-qa' OR site.is_published = false)
        AND public.can_manage_resume(site.id);
  ELSIF caller_role = 'qa' AND caller_resume_id = target_resume_id THEN
    SELECT site.site_key INTO resolved_site_key
      FROM public.resume_sites AS site
      WHERE site.id = target_resume_id
        AND site.site_key = 'example-cv-qa'
        AND site.is_published = false
        AND public.can_manage_resume(site.id);
  ELSE
    RAISE EXCEPTION 'Activity Log access denied' USING ERRCODE = '42501';
  END IF;

  IF resolved_site_key IS NULL THEN
    RAISE EXCEPTION 'Activity Log access denied' USING ERRCODE = '42501';
  END IF;
  resolved_role := caller_role;
  RETURN NEXT;
END
$function$;
REVOKE ALL ON FUNCTION cms_private.assert_activity_log_system_event_target(uuid)
  FROM PUBLIC, anon, authenticated, service_role;

-- Canonical CIDR form is network-address text plus the prefix. IPv4 uses
-- dotted-decimal octets. IPv6 uses exactly eight lowercase, zero-padded
-- four-hex-digit groups, so a Worker need not mimic PostgreSQL compression.
CREATE FUNCTION cms_private.activity_log_v13_canonical_cidr(target_network cidr)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $function$
DECLARE
  address_value text;
  left_value text;
  right_value text;
  left_groups text[] := ARRAY[]::text[];
  right_groups text[] := ARRAY[]::text[];
  groups_value text[];
  fill_count integer;
  group_index integer;
BEGIN
  IF target_network IS NULL THEN
    RETURN NULL;
  END IF;

  address_value := pg_catalog.host(pg_catalog.network(target_network));
  IF pg_catalog.family(target_network) = 4 THEN
    RETURN address_value || '/' || pg_catalog.masklen(target_network)::text;
  END IF;

  IF pg_catalog.strpos(address_value, '::') > 0 THEN
    left_value := pg_catalog.split_part(address_value, '::', 1);
    right_value := pg_catalog.split_part(address_value, '::', 2);
    IF left_value <> '' THEN
      left_groups := pg_catalog.string_to_array(left_value, ':');
    END IF;
    IF right_value <> '' THEN
      right_groups := pg_catalog.string_to_array(right_value, ':');
    END IF;
    fill_count := 8 - pg_catalog.cardinality(left_groups) - pg_catalog.cardinality(right_groups);
    IF fill_count < 1 THEN
      RAISE EXCEPTION 'Invalid V1.3 network value' USING ERRCODE = '22023';
    END IF;
    groups_value := pg_catalog.array_cat(
      pg_catalog.array_cat(left_groups, pg_catalog.array_fill('0'::text, ARRAY[fill_count])),
      right_groups
    );
  ELSE
    groups_value := pg_catalog.string_to_array(address_value, ':');
  END IF;

  IF pg_catalog.cardinality(groups_value) <> 8 THEN
    RAISE EXCEPTION 'Invalid V1.3 network value' USING ERRCODE = '22023';
  END IF;
  FOR group_index IN 1..8 LOOP
    groups_value[group_index] := pg_catalog.lpad(pg_catalog.lower(groups_value[group_index]), 4, '0');
  END LOOP;
  RETURN pg_catalog.array_to_string(groups_value, ':') || '/' || pg_catalog.masklen(target_network)::text;
END
$function$;
REVOKE ALL ON FUNCTION cms_private.activity_log_v13_canonical_cidr(cidr)
  FROM PUBLIC, anon, authenticated, service_role;

-- V1.3 canonical-byte protocol version 1:
-- fixed field order is protocol_version, purpose, key_id, event_id,
-- request_id, actor_user_id, resume_id, event_kind, outcome, section_key,
-- operation, failure_stage, failure_code, issued_at_epoch, ip_network,
-- country_code, region, city. Each NULL is the two ASCII bytes `N;`.
-- Each non-NULL value is ASCII `V` + its base-10 UTF-8 byte length + `:`
-- followed by exactly those UTF-8 bytes. Read the decimal length to find the
-- next field; content bytes are never separators. Thus NULL, empty text,
-- delimiter text, newline, backslash, quotes, and Unicode cannot collide.
-- Text is not Unicode-normalized.
-- UUIDs are lowercase hyphenated text; integers are base-10 ASCII;
-- issued_at_epoch is Unix epoch seconds (integer precision); CIDR is the
-- normalized network text returned by activity_log_v13_canonical_cidr.
-- This is a byte framing contract, not JSON/JSONB serialization.
CREATE FUNCTION cms_private.activity_log_v13_canonical_bytes(
  target_protocol_version integer,
  target_purpose text,
  target_key_id text,
  target_event_id uuid,
  target_request_id uuid,
  target_actor_user_id uuid,
  target_resume_id uuid,
  target_event_kind text,
  target_outcome text,
  target_section_key text,
  target_operation text,
  target_failure_stage text,
  target_failure_code text,
  target_issued_at_epoch bigint,
  target_ip_network cidr,
  target_country_code text,
  target_region text,
  target_city text
)
RETURNS bytea
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $function$
DECLARE
  field_value text;
  field_values text[];
  canonical_value bytea := pg_catalog.decode('', 'hex');
BEGIN
  field_values := ARRAY[
    target_protocol_version::text,
    target_purpose,
    target_key_id,
    target_event_id::text,
    target_request_id::text,
    target_actor_user_id::text,
    target_resume_id::text,
    target_event_kind,
    target_outcome,
    target_section_key,
    target_operation,
    target_failure_stage,
    target_failure_code,
    target_issued_at_epoch::text,
    cms_private.activity_log_v13_canonical_cidr(target_ip_network),
    target_country_code,
    target_region,
    target_city
  ];

  IF pg_catalog.cardinality(field_values) <> 18 THEN
    RAISE EXCEPTION 'Invalid V1.3 canonical field count' USING ERRCODE = '22023';
  END IF;
  FOREACH field_value IN ARRAY field_values LOOP
    IF field_value IS NULL THEN
      canonical_value := canonical_value || pg_catalog.convert_to('N;', 'UTF8');
    ELSE
      canonical_value := canonical_value
        || pg_catalog.convert_to(
          'V' || pg_catalog.octet_length(pg_catalog.convert_to(field_value, 'UTF8'))::text || ':',
          'UTF8'
        )
        || pg_catalog.convert_to(field_value, 'UTF8');
    END IF;
  END LOOP;
  RETURN canonical_value;
END
$function$;
REVOKE ALL ON FUNCTION cms_private.activity_log_v13_canonical_bytes(
  integer, text, text, uuid, uuid, uuid, uuid, text, text, text,
  text, text, text, bigint, cidr, text, text, text
) FROM PUBLIC, anon, authenticated, service_role;

-- No failed business payload/error text is accepted.
CREATE FUNCTION public.record_activity_log_system_failure(
  target_resume_id uuid,
  target_event_id uuid,
  target_request_id uuid,
  target_actor_user_id uuid,
  target_protocol_version integer,
  target_purpose text,
  target_key_id text,
  target_event_kind text,
  target_outcome text,
  target_section_key text,
  target_operation text,
  target_failure_stage text,
  target_failure_code text,
  target_issued_at_epoch bigint,
  target_ip_network cidr,
  target_country_code text,
  target_region text,
  target_city text,
  target_signature_hex text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  target_context record;
  actor_email_value text;
  canonical_value bytea;
  key_value bytea;
  provided_signature bytea;
  expected_signature bytea;
  existing_event cms_private.activity_log_system_events%ROWTYPE;
  inserted_value boolean := false;
  signed_occurred_at timestamptz;
  current_epoch bigint;
BEGIN
  IF (SELECT auth.uid()) IS NULL THEN
    RAISE EXCEPTION 'Activity Log access denied' USING ERRCODE = '42501';
  END IF;

  SELECT context.resolved_site_key, context.resolved_role
    INTO target_context
    FROM cms_private.assert_activity_log_system_event_target(target_resume_id) AS context;

  IF NOT COALESCE((
    SELECT capability.enabled
      FROM cms_private.resume_capabilities AS capability
      WHERE capability.resume_id = target_resume_id
        AND capability.capability_key = 'activity_log_system_events'
  ), false) THEN
    RAISE EXCEPTION 'Activity Log access denied' USING ERRCODE = '42501';
  END IF;

  actor_email_value := (SELECT auth.jwt() ->> 'email');
  current_epoch := pg_catalog.floor(pg_catalog.date_part('epoch', pg_catalog.clock_timestamp()))::bigint;
  IF target_event_id IS NULL OR target_request_id IS NULL
    OR target_actor_user_id IS DISTINCT FROM (SELECT auth.uid())
    OR target_protocol_version IS DISTINCT FROM 1
    OR target_purpose IS DISTINCT FROM 'activity_log_system_event_v13'
    OR target_key_id IS DISTINCT FROM 'activity_log_v13_failure_v1'
    OR target_event_kind IS DISTINCT FROM 'operation_failure'
    OR target_outcome IS DISTINCT FROM 'rejected'
    OR target_section_key IS DISTINCT FROM 'introduction'
    OR target_operation IS DISTINCT FROM 'update'
    OR target_failure_stage IS NULL OR target_failure_code IS NULL
    OR NOT (
      (target_failure_stage = 'trusted_context_validation' AND target_failure_code = 'trusted_context_rejected') OR
      (target_failure_stage = 'database_validation' AND target_failure_code = 'business_validation_rejected') OR
      (target_failure_stage = 'idempotency' AND target_failure_code = 'idempotency_conflict') OR
      (target_failure_stage = 'write_configuration' AND target_failure_code = 'authorized_write_configuration_rejected')
    )
    OR target_issued_at_epoch IS NULL
    OR target_issued_at_epoch < current_epoch - 180
    OR target_issued_at_epoch > current_epoch + 60
    OR (target_ip_network IS NOT NULL AND NOT (
      (pg_catalog.family(target_ip_network) = 4 AND pg_catalog.masklen(target_ip_network) = 24) OR
      (pg_catalog.family(target_ip_network) = 6 AND pg_catalog.masklen(target_ip_network) = 48)
    ))
    OR (target_country_code IS NOT NULL AND target_country_code COLLATE pg_catalog."C" !~ '^[A-Z]{2}$')
    OR (target_region IS NOT NULL AND (
      pg_catalog.octet_length(target_region) NOT BETWEEN 1 AND 128 OR target_region ~ '[[:cntrl:]]'
    ))
    OR (target_city IS NOT NULL AND (
      pg_catalog.octet_length(target_city) NOT BETWEEN 1 AND 128 OR target_city ~ '[[:cntrl:]]'
    ))
    OR (actor_email_value IS NOT NULL AND pg_catalog.octet_length(actor_email_value) > 320) THEN
    RAISE EXCEPTION 'Invalid signed system event' USING ERRCODE = '22023';
  END IF;

  signed_occurred_at := pg_catalog.to_timestamp(target_issued_at_epoch::double precision);
  canonical_value := cms_private.activity_log_v13_canonical_bytes(
    target_protocol_version, target_purpose, target_key_id, target_event_id,
    target_request_id, target_actor_user_id, target_resume_id, target_event_kind,
    target_outcome, target_section_key, target_operation, target_failure_stage,
    target_failure_code, target_issued_at_epoch, target_ip_network,
    target_country_code, target_region, target_city
  );

  BEGIN
    IF target_signature_hex IS NULL
      OR (target_signature_hex COLLATE pg_catalog."C") !~ '^[0-9a-f]{64}$' THEN
      RAISE EXCEPTION 'Invalid signed system event' USING ERRCODE = '22023';
    END IF;
    provided_signature := pg_catalog.decode(target_signature_hex, 'hex');
    key_value := cms_private.activity_log_v13_key(target_key_id);
    expected_signature := extensions.hmac(
      canonical_value, key_value, 'sha256'
    );
    -- Residual: PostgreSQL bytea equality is not asserted to be constant-time.
    -- Reassess with the Worker verification implementation before activation.
    IF provided_signature <> expected_signature THEN
      RAISE EXCEPTION 'Invalid signed system event' USING ERRCODE = '22023';
    END IF;
  EXCEPTION
    WHEN OTHERS THEN
      RAISE EXCEPTION 'Invalid signed system event' USING ERRCODE = '22023';
  END;

  INSERT INTO cms_private.activity_log_system_events (
    event_id, occurred_at, resume_id, site_key_snapshot,
    actor_user_id, actor_email_snapshot, actor_role_snapshot,
    event_kind, outcome, section_key, operation, failure_stage, failure_code,
    request_id, ip_network, country_code, region, city
  ) VALUES (
    target_event_id, signed_occurred_at, target_resume_id, target_context.resolved_site_key,
    target_actor_user_id, actor_email_value, target_context.resolved_role,
    target_event_kind, target_outcome, target_section_key, target_operation,
    target_failure_stage, target_failure_code, target_request_id,
    target_ip_network, target_country_code, target_region, target_city
  ) ON CONFLICT (event_id) DO NOTHING
  RETURNING true INTO inserted_value;

  IF inserted_value IS DISTINCT FROM true THEN
    inserted_value := false;
    SELECT event.* INTO existing_event
      FROM cms_private.activity_log_system_events AS event
      WHERE event.event_id = target_event_id;
    -- site/role/email are first-write snapshots derived from trusted database
    -- state, not envelope fields. An exact signed retry preserves those first
    -- snapshots even if a refreshed token or membership context differs.
    IF NOT FOUND
      OR existing_event.occurred_at IS DISTINCT FROM signed_occurred_at
      OR existing_event.resume_id IS DISTINCT FROM target_resume_id
      OR existing_event.actor_user_id IS DISTINCT FROM target_actor_user_id
      OR existing_event.event_kind IS DISTINCT FROM target_event_kind
      OR existing_event.outcome IS DISTINCT FROM target_outcome
      OR existing_event.section_key IS DISTINCT FROM target_section_key
      OR existing_event.operation IS DISTINCT FROM target_operation
      OR existing_event.failure_stage IS DISTINCT FROM target_failure_stage
      OR existing_event.failure_code IS DISTINCT FROM target_failure_code
      OR existing_event.request_id IS DISTINCT FROM target_request_id
      OR existing_event.ip_network IS DISTINCT FROM target_ip_network
      OR existing_event.country_code IS DISTINCT FROM target_country_code
      OR existing_event.region IS DISTINCT FROM target_region
      OR existing_event.city IS DISTINCT FROM target_city THEN
      RAISE EXCEPTION 'Invalid signed system event' USING ERRCODE = '22023';
    END IF;
  END IF;

  RETURN pg_catalog.jsonb_build_object('event_id', target_event_id, 'recorded', inserted_value);
END
$function$;

REVOKE ALL ON FUNCTION public.record_activity_log_system_failure(
  uuid, uuid, uuid, uuid, integer, text, text, text, text, text,
  text, text, text, bigint, cidr, text, text, text, text
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.record_activity_log_system_failure(
  uuid, uuid, uuid, uuid, integer, text, text, text, text, text,
  text, text, text, bigint, cidr, text, text, text, text
) TO authenticated;

COMMENT ON TABLE cms_private.activity_log_system_events IS
  'Immutable target-scoped V1.3 failed-operation/system events; no business payloads or raw errors.';
COMMENT ON COLUMN cms_private.activity_log_system_events.event_id IS
  'Signed report identity and idempotency key; request_id remains non-unique correlation.';

COMMIT;
