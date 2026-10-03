-- Activity Log V1.3B: give only the signed Introduction idempotency conflict
-- a dedicated machine-readable SQLSTATE. No gate or event data is changed.
BEGIN;

DO $owner_guard$
BEGIN
  IF current_user <> 'postgres' THEN
    RAISE EXCEPTION 'Activity Log V1.3B must be installed as postgres'
      USING ERRCODE = '42501';
  END IF;
END
$owner_guard$;

CREATE OR REPLACE FUNCTION public.save_resume_introduction_v11(
  target_resume_id uuid,
  canonical_items text,
  signed_context text,
  signature_hex text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  target_site_key text;
  gate_enabled boolean;
  verified_context jsonb;
  verified_items jsonb;
  request_actor uuid;
  request_id_value uuid;
  request_digest bytea;
  existing_digest bytea;
  existing_completed_at timestamptz;
  existing_expires_at timestamptz;
  existing_result jsonb;
  canonical_result jsonb;
BEGIN
  IF (SELECT auth.uid()) IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;
  SELECT context.resolved_site_key INTO target_site_key
  FROM cms_private.assert_activity_log_target(target_resume_id) AS context;
  IF target_site_key IS NULL THEN
    RAISE EXCEPTION 'Introduction target is not authorized' USING ERRCODE = '42501';
  END IF;
  PERFORM 1 FROM public.resume_sites AS site WHERE site.id = target_resume_id FOR UPDATE;
  PERFORM 1 FROM cms_private.assert_activity_log_target(target_resume_id);
  IF cms_private.get_resume_write_mode(target_resume_id, 'introduction') <> 'rpc' THEN
    RAISE EXCEPTION 'Introduction RPC mode is not enabled for this target' USING ERRCODE = '42501';
  END IF;
  SELECT requirement.enabled INTO gate_enabled
  FROM cms_private.resume_domain_requirements AS requirement
  WHERE requirement.resume_id = target_resume_id
    AND requirement.domain_key = 'introduction'
    AND requirement.requirement_key = 'trusted_network_context_v11';
  IF NOT COALESCE(gate_enabled, false) THEN
    RAISE EXCEPTION 'V1.1 Introduction context is not enabled' USING ERRCODE = '42501';
  END IF;

  SELECT verified.context_value, verified.items_value
  INTO verified_context, verified_items
  FROM cms_private.verify_resume_introduction_v11_context(
    target_resume_id, canonical_items, signed_context, signature_hex
  ) AS verified;
  request_actor := (verified_context->>'actor_user_id')::uuid;
  request_id_value := (verified_context->>'request_id')::uuid;
  request_digest := extensions.digest(pg_catalog.convert_to(canonical_items, 'UTF8'), 'sha256');

  SELECT prior.mutation_digest, prior.completed_at, prior.expires_at, prior.result_payload
  INTO existing_digest, existing_completed_at, existing_expires_at, existing_result
  FROM cms_private.activity_log_idempotency AS prior
  WHERE prior.actor_user_id = request_actor
    AND prior.resume_id = target_resume_id
    AND prior.domain_key = 'introduction'
    AND prior.request_id = request_id_value
  FOR UPDATE;
  IF FOUND THEN
    IF existing_expires_at <= pg_catalog.clock_timestamp() THEN
      RAISE EXCEPTION 'Idempotency request has expired; use a new request ID' USING ERRCODE = '22023';
    END IF;
    IF existing_digest <> request_digest THEN
      RAISE EXCEPTION 'Idempotency key conflicts with a different request' USING ERRCODE = 'P13B1';
    END IF;
    IF existing_completed_at IS NULL OR existing_result IS NULL THEN
      RAISE EXCEPTION 'Idempotency key conflicts with a different request' USING ERRCODE = '23505';
    END IF;
    RETURN existing_result;
  END IF;

  INSERT INTO cms_private.activity_log_idempotency(
    actor_user_id, resume_id, domain_key, request_id, mutation_digest,
    created_at, completed_at, expires_at
  ) VALUES (
    request_actor, target_resume_id, 'introduction', request_id_value, request_digest,
    pg_catalog.transaction_timestamp(), NULL,
    pg_catalog.transaction_timestamp() + interval '7 days'
  );
  canonical_result := cms_private.apply_resume_introduction(target_resume_id, verified_items, verified_context);
  UPDATE cms_private.activity_log_idempotency
  SET result_payload = canonical_result,
      completed_at = pg_catalog.transaction_timestamp()
  WHERE actor_user_id = request_actor AND resume_id = target_resume_id
    AND domain_key = 'introduction' AND request_id = request_id_value;
  RETURN canonical_result;
END
$function$;

COMMIT;
