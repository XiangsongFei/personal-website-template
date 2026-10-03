-- Activity Log V1.1 local foundation.
-- This migration is additive and deliberately leaves every V1.1 requirement
-- absent (therefore off). It contains no signing key and does not configure
-- the production Vault adapter.
BEGIN;

DO $owner_guard$
BEGIN
  IF current_user <> 'postgres' THEN
    RAISE EXCEPTION 'Activity Log V1.1 foundation must be installed as postgres'
      USING ERRCODE = '42501';
  END IF;
END
$owner_guard$;

-- Fail safely if the explicitly reviewed extension schema/signatures are not
-- present. Production must pass the separate read-only pgcrypto runtime gate.
DO $crypto_prerequisite$
BEGIN
  IF pg_catalog.to_regprocedure('extensions.hmac(bytea,bytea,text)') IS NULL
    OR pg_catalog.to_regprocedure('extensions.digest(bytea,text)') IS NULL THEN
    RAISE EXCEPTION 'Activity Log V1.1 requires extensions.pgcrypto hmac/digest'
      USING ERRCODE = '0A000';
  END IF;
END
$crypto_prerequisite$;

ALTER TABLE cms_private.activity_log_events
  ADD COLUMN ip_network cidr,
  ADD COLUMN country_code text,
  ADD COLUMN region text,
  ADD COLUMN city text,
  ADD CONSTRAINT activity_log_ip_network_prefix_check CHECK (
    ip_network IS NULL OR
    (pg_catalog.family(ip_network) = 4 AND pg_catalog.masklen(ip_network) = 24) OR
    (pg_catalog.family(ip_network) = 6 AND pg_catalog.masklen(ip_network) = 48)
  ),
  ADD CONSTRAINT activity_log_country_code_check CHECK (
    country_code IS NULL OR (country_code COLLATE "C" ~ '^[A-Z]{2}$')
  ),
  ADD CONSTRAINT activity_log_region_check CHECK (
    region IS NULL OR (pg_catalog.octet_length(region) BETWEEN 1 AND 128 AND region !~ '[[:cntrl:]]')
  ),
  ADD CONSTRAINT activity_log_city_check CHECK (
    city IS NULL OR (pg_catalog.octet_length(city) BETWEEN 1 AND 128 AND city !~ '[[:cntrl:]]')
  );

CREATE TABLE cms_private.resume_domain_requirements (
  resume_id uuid NOT NULL REFERENCES public.resume_sites(id) ON DELETE CASCADE,
  domain_key text NOT NULL CHECK (domain_key IN (
    'introduction', 'education', 'experience', 'awards', 'skills',
    'contact', 'projects', 'website_links', 'profile', 'files'
  )),
  requirement_key text NOT NULL CHECK (requirement_key IN ('trusted_network_context_v11')),
  enabled boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT pg_catalog.transaction_timestamp(),
  PRIMARY KEY (resume_id, domain_key, requirement_key)
);
ALTER TABLE cms_private.resume_domain_requirements ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE cms_private.resume_domain_requirements
  FROM PUBLIC, anon, authenticated, service_role, pg_write_all_data;

-- The bounded canonical RPC result is retained privately for seven days so a
-- matching retry replays the original response, not a later database state.
CREATE TABLE cms_private.activity_log_idempotency (
  actor_user_id uuid NOT NULL,
  resume_id uuid NOT NULL REFERENCES public.resume_sites(id) ON DELETE CASCADE,
  domain_key text NOT NULL CHECK (domain_key IN (
    'introduction', 'education', 'experience', 'awards', 'skills',
    'contact', 'projects', 'website_links', 'profile', 'files'
  )),
  request_id uuid NOT NULL,
  mutation_digest bytea NOT NULL CHECK (pg_catalog.octet_length(mutation_digest) = 32),
  result_payload jsonb,
  created_at timestamptz NOT NULL DEFAULT pg_catalog.transaction_timestamp(),
  completed_at timestamptz,
  expires_at timestamptz NOT NULL,
  PRIMARY KEY (actor_user_id, resume_id, domain_key, request_id),
  CHECK (completed_at IS NULL OR completed_at >= created_at),
  CHECK ((completed_at IS NULL AND result_payload IS NULL)
      OR (completed_at IS NOT NULL AND result_payload IS NOT NULL)),
  -- 384 KiB bounds the canonical response including per-item result envelopes
  -- while leaving room above the signed request's 256 KiB byte ceiling.
  CHECK (result_payload IS NULL OR CASE
    WHEN pg_catalog.jsonb_typeof(result_payload) = 'array' THEN
      pg_catalog.jsonb_array_length(result_payload) <= 200
      AND pg_catalog.octet_length(pg_catalog.convert_to(result_payload::text, 'UTF8')) <= 393216
    ELSE false
  END),
  CHECK (expires_at = created_at + interval '7 days')
);
CREATE INDEX activity_log_idempotency_expiry_idx
  ON cms_private.activity_log_idempotency (expires_at);
ALTER TABLE cms_private.activity_log_idempotency ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE cms_private.activity_log_idempotency
  FROM PUBLIC, anon, authenticated, service_role, pg_write_all_data;

-- Provider boundary. Production Vault integration is intentionally absent:
-- this fail-closed implementation is replaced only by an explicitly reviewed
-- Vault adapter. The isolated local runtime lab installs a separate test-only
-- provider returning a synthetic key.
CREATE FUNCTION cms_private.activity_log_v11_key(target_key_id text)
RETURNS bytea
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  RAISE EXCEPTION 'Invalid signed context' USING ERRCODE = '22023';
END
$function$;
REVOKE ALL ON FUNCTION cms_private.activity_log_v11_key(text)
  FROM PUBLIC, anon, authenticated, service_role;

-- Shared mutation implementation based on the frozen 20261004 Phase 1
-- implementation, with a targeted fix to retain generated paragraph IDs during
-- cleanup for both legacy and V1.1 saves. Its EXECUTE privilege is private;
-- public wrappers own all security checks.
CREATE FUNCTION cms_private.apply_resume_introduction(target_resume_id uuid, target_items jsonb, context_value jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $function$
DECLARE
  site_key_value text; actor_role_value text; actor_email_value text; item jsonb;
  saved_id uuid; requested_id text; item_position integer;
  v11_generated_ids uuid[] := ARRAY[]::uuid[];
  before_rows jsonb; after_rows jsonb; changes_value jsonb;
  field_before jsonb; field_after jsonb;
  max_position integer; position_offset bigint; desired_count integer;
BEGIN
  IF (SELECT auth.uid()) IS NULL THEN RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501'; END IF;
  SELECT context.resolved_site_key, context.resolved_role INTO site_key_value, actor_role_value
  FROM cms_private.assert_activity_log_target(target_resume_id) AS context;
  PERFORM 1 FROM public.resume_sites AS site WHERE site.id=target_resume_id FOR UPDATE;
  IF site_key_value IS NULL THEN RAISE EXCEPTION 'Introduction target is not authorized' USING ERRCODE = '42501'; END IF;
  IF cms_private.get_resume_write_mode(target_resume_id, 'introduction') <> 'rpc' THEN
    RAISE EXCEPTION 'Introduction RPC mode is not enabled for this target' USING ERRCODE = '42501';
  END IF;
  actor_email_value := (SELECT auth.jwt() ->> 'email');
  IF target_items IS NULL OR pg_catalog.jsonb_typeof(target_items) <> 'array'
    OR pg_catalog.jsonb_array_length(target_items) > 200 THEN
    RAISE EXCEPTION 'Invalid Introduction items' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.jsonb_array_elements(target_items) AS e(value)
    WHERE pg_catalog.jsonb_typeof(e.value) <> 'object'
      OR (SELECT count(*) FROM pg_catalog.jsonb_object_keys(e.value)) <> 3
      OR NOT (e.value ? 'id') OR NOT (e.value ? 'zh') OR NOT (e.value ? 'en')
      OR pg_catalog.jsonb_typeof(e.value->'id') NOT IN ('string','null')
      OR pg_catalog.jsonb_typeof(e.value->'zh') <> 'string'
      OR pg_catalog.jsonb_typeof(e.value->'en') <> 'string'
      OR pg_catalog.length(e.value->>'zh') > 12000 OR pg_catalog.length(e.value->>'en') > 12000) THEN
    RAISE EXCEPTION 'Invalid Introduction item shape' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.jsonb_array_elements(target_items) AS e(value)
    WHERE e.value->>'id' IS NOT NULL AND e.value->>'id' !~ '^local-[0-9]+-[0-9]+$'
      AND e.value->>'id' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') THEN
    RAISE EXCEPTION 'Invalid Introduction item identity' USING ERRCODE = '22023';
  END IF;
  IF (SELECT count(*) FROM (SELECT e.value->>'id' AS id FROM pg_catalog.jsonb_array_elements(target_items) AS e(value)
      WHERE e.value->>'id' IS NOT NULL AND e.value->>'id' NOT LIKE 'local-%' GROUP BY e.value->>'id' HAVING count(*) > 1) AS duplicates) > 0 THEN
    RAISE EXCEPTION 'Duplicate Introduction item identity' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.jsonb_array_elements(target_items) AS e(value)
    WHERE e.value->>'id' IS NOT NULL AND e.value->>'id' NOT LIKE 'local-%'
      AND NOT EXISTS (SELECT 1 FROM public.resume_intro_paragraphs AS p WHERE p.id::text=e.value->>'id' AND p.resume_id=target_resume_id)) THEN
    RAISE EXCEPTION 'Introduction item is outside the target' USING ERRCODE = '42501';
  END IF;

  SELECT COALESCE(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'id', p.id::text, 'position', p.position, 'text_zh', COALESCE(zh.text,''), 'text_en', COALESCE(en.text,'')) ORDER BY p.position,p.id), '[]'::jsonb)
    INTO before_rows FROM public.resume_intro_paragraphs AS p
    LEFT JOIN public.resume_intro_paragraph_translations AS zh ON zh.paragraph_id=p.id AND zh.resume_id=p.resume_id AND zh.locale='zh'
    LEFT JOIN public.resume_intro_paragraph_translations AS en ON en.paragraph_id=p.id AND en.resume_id=p.resume_id AND en.locale='en'
    WHERE p.resume_id=target_resume_id;

  SELECT count(*)::integer INTO desired_count FROM pg_catalog.jsonb_array_elements(target_items);
  SELECT COALESCE(max(position),-1) INTO max_position FROM public.resume_intro_paragraphs WHERE resume_id=target_resume_id;
  IF max_position > ((2147483647 - desired_count - 1001) / 2) THEN RAISE EXCEPTION 'Introduction ordering cannot be safely updated'; END IF;
  IF desired_count = pg_catalog.jsonb_array_length(before_rows)
    AND NOT EXISTS (
      SELECT 1 FROM pg_catalog.jsonb_array_elements(target_items) WITH ORDINALITY AS incoming(value,ordinality)
      LEFT JOIN pg_catalog.jsonb_array_elements(before_rows) WITH ORDINALITY AS current_row(value,ordinality)
        ON current_row.ordinality=incoming.ordinality
      WHERE incoming.value->>'id' IS DISTINCT FROM current_row.value->>'id'
        OR current_row.value->>'position' IS DISTINCT FROM ((incoming.ordinality-1)::text)
        OR incoming.value->>'zh' IS DISTINCT FROM current_row.value->>'text_zh'
        OR incoming.value->>'en' IS DISTINCT FROM current_row.value->>'text_en'
    ) THEN
    RETURN (SELECT COALESCE(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'id',p.id::text,'position',p.position,'translations',pg_catalog.jsonb_build_object(
        'zh',pg_catalog.jsonb_build_object('text',COALESCE(zh.text,'')),
        'en',pg_catalog.jsonb_build_object('text',COALESCE(en.text,'')))) ORDER BY p.position,p.id),'[]'::jsonb)
      FROM public.resume_intro_paragraphs AS p
      LEFT JOIN public.resume_intro_paragraph_translations AS zh ON zh.paragraph_id=p.id AND zh.resume_id=p.resume_id AND zh.locale='zh'
      LEFT JOIN public.resume_intro_paragraph_translations AS en ON en.paragraph_id=p.id AND en.resume_id=p.resume_id AND en.locale='en'
      WHERE p.resume_id=target_resume_id);
  END IF;
  position_offset := max_position::bigint + desired_count + 1001;
  UPDATE public.resume_intro_paragraphs SET position=(position + position_offset)::integer
    WHERE resume_id=target_resume_id;

  FOR item, item_position IN SELECT e.value, (e.ordinality-1)::integer
    FROM pg_catalog.jsonb_array_elements(target_items) WITH ORDINALITY AS e(value,ordinality) LOOP
    requested_id := item->>'id';
    IF requested_id IS NULL OR requested_id LIKE 'local-%' THEN
      INSERT INTO public.resume_intro_paragraphs(resume_id,position,source_key)
        VALUES(target_resume_id,item_position,NULL) RETURNING id INTO saved_id;
      v11_generated_ids := pg_catalog.array_append(v11_generated_ids,saved_id);
    ELSE
      saved_id := requested_id::uuid;
      UPDATE public.resume_intro_paragraphs SET position=item_position, updated_at=pg_catalog.transaction_timestamp()
        WHERE id=saved_id AND resume_id=target_resume_id AND position IS DISTINCT FROM item_position;
    END IF;
    INSERT INTO public.resume_intro_paragraph_translations(paragraph_id,resume_id,locale,text)
      VALUES(saved_id,target_resume_id,'zh',item->>'zh'),(saved_id,target_resume_id,'en',item->>'en')
      ON CONFLICT(paragraph_id,locale) DO UPDATE SET text=EXCLUDED.text, updated_at=pg_catalog.transaction_timestamp()
      WHERE public.resume_intro_paragraph_translations.text IS DISTINCT FROM EXCLUDED.text;
  END LOOP;

  DELETE FROM public.resume_intro_paragraphs AS p WHERE p.resume_id=target_resume_id
    AND NOT (p.id = ANY(v11_generated_ids))
    AND NOT EXISTS (SELECT 1 FROM pg_catalog.jsonb_array_elements(target_items) AS e(value)
      WHERE e.value->>'id'=p.id::text AND e.value->>'id' NOT LIKE 'local-%');

  SELECT COALESCE(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'id', p.id::text, 'position', p.position, 'text_zh', COALESCE(zh.text,''), 'text_en', COALESCE(en.text,'')) ORDER BY p.position,p.id), '[]'::jsonb)
    INTO after_rows FROM public.resume_intro_paragraphs AS p
    LEFT JOIN public.resume_intro_paragraph_translations AS zh ON zh.paragraph_id=p.id AND zh.resume_id=p.resume_id AND zh.locale='zh'
    LEFT JOIN public.resume_intro_paragraph_translations AS en ON en.paragraph_id=p.id AND en.resume_id=p.resume_id AND en.locale='en'
    WHERE p.resume_id=target_resume_id;

  changes_value := '{}'::jsonb;
  SELECT COALESCE(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('id',COALESCE(old_row.value->>'id',new_row.value->>'id'),'value',old_row.value->'text_zh')
      ORDER BY COALESCE((old_row.value->>'position')::integer,(new_row.value->>'position')::integer),COALESCE(old_row.value->>'id',new_row.value->>'id')),'[]'::jsonb),
    COALESCE(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('id',COALESCE(old_row.value->>'id',new_row.value->>'id'),'value',new_row.value->'text_zh')
      ORDER BY COALESCE((old_row.value->>'position')::integer,(new_row.value->>'position')::integer),COALESCE(old_row.value->>'id',new_row.value->>'id')),'[]'::jsonb)
    INTO field_before,field_after FROM pg_catalog.jsonb_array_elements(before_rows) AS old_row(value)
    FULL JOIN pg_catalog.jsonb_array_elements(after_rows) AS new_row(value) ON old_row.value->>'id'=new_row.value->>'id'
    WHERE old_row.value->'text_zh' IS DISTINCT FROM new_row.value->'text_zh';
  IF pg_catalog.jsonb_array_length(field_before)>0 THEN changes_value := changes_value || pg_catalog.jsonb_build_object('text_zh',pg_catalog.jsonb_build_object('before',field_before,'after',field_after)); END IF;

  SELECT COALESCE(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('id',COALESCE(old_row.value->>'id',new_row.value->>'id'),'value',old_row.value->'text_en')
      ORDER BY COALESCE((old_row.value->>'position')::integer,(new_row.value->>'position')::integer),COALESCE(old_row.value->>'id',new_row.value->>'id')),'[]'::jsonb),
    COALESCE(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('id',COALESCE(old_row.value->>'id',new_row.value->>'id'),'value',new_row.value->'text_en')
      ORDER BY COALESCE((old_row.value->>'position')::integer,(new_row.value->>'position')::integer),COALESCE(old_row.value->>'id',new_row.value->>'id')),'[]'::jsonb)
    INTO field_before,field_after FROM pg_catalog.jsonb_array_elements(before_rows) AS old_row(value)
    FULL JOIN pg_catalog.jsonb_array_elements(after_rows) AS new_row(value) ON old_row.value->>'id'=new_row.value->>'id'
    WHERE old_row.value->'text_en' IS DISTINCT FROM new_row.value->'text_en';
  IF pg_catalog.jsonb_array_length(field_before)>0 THEN changes_value := changes_value || pg_catalog.jsonb_build_object('text_en',pg_catalog.jsonb_build_object('before',field_before,'after',field_after)); END IF;

  SELECT COALESCE(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('id',COALESCE(old_row.value->>'id',new_row.value->>'id'),'value',old_row.value->'position')
      ORDER BY COALESCE((old_row.value->>'position')::integer,(new_row.value->>'position')::integer),COALESCE(old_row.value->>'id',new_row.value->>'id')),'[]'::jsonb),
    COALESCE(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('id',COALESCE(old_row.value->>'id',new_row.value->>'id'),'value',new_row.value->'position')
      ORDER BY COALESCE((old_row.value->>'position')::integer,(new_row.value->>'position')::integer),COALESCE(old_row.value->>'id',new_row.value->>'id')),'[]'::jsonb)
    INTO field_before,field_after FROM pg_catalog.jsonb_array_elements(before_rows) AS old_row(value)
    FULL JOIN pg_catalog.jsonb_array_elements(after_rows) AS new_row(value) ON old_row.value->>'id'=new_row.value->>'id'
    WHERE old_row.value->'position' IS DISTINCT FROM new_row.value->'position';
  IF pg_catalog.jsonb_array_length(field_before)>0 THEN changes_value := changes_value || pg_catalog.jsonb_build_object('position',pg_catalog.jsonb_build_object('before',field_before,'after',field_after)); END IF;

  IF changes_value <> '{}'::jsonb THEN
    INSERT INTO cms_private.activity_log_events(actor_user_id,actor_email_snapshot,actor_role_snapshot,resume_id,site_key_snapshot,
      operation,section_key,entity_type,entity_id,entity_snapshot,changes,ip_network,country_code,region,city)
    VALUES((SELECT auth.uid()),actor_email_value,actor_role_value,target_resume_id,site_key_value,
      'update','introduction','introduction_paragraph','introduction',
      pg_catalog.jsonb_build_object('paragraphs',after_rows),changes_value,
      (context_value->>'ip_network')::cidr, context_value->>'country_code',
      context_value->>'region', context_value->>'city');
  END IF;
  RETURN (SELECT COALESCE(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'id',p.id::text,'position',p.position,'translations',pg_catalog.jsonb_build_object(
      'zh',pg_catalog.jsonb_build_object('text',COALESCE(zh.text,'')),
      'en',pg_catalog.jsonb_build_object('text',COALESCE(en.text,'')))) ORDER BY p.position,p.id),'[]'::jsonb)
    FROM public.resume_intro_paragraphs AS p
    LEFT JOIN public.resume_intro_paragraph_translations AS zh ON zh.paragraph_id=p.id AND zh.resume_id=p.resume_id AND zh.locale='zh'
    LEFT JOIN public.resume_intro_paragraph_translations AS en ON en.paragraph_id=p.id AND en.resume_id=p.resume_id AND en.locale='en'
    WHERE p.resume_id=target_resume_id);
END
$function$;

CREATE FUNCTION cms_private.read_resume_introduction(target_resume_id uuid)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT COALESCE(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'id', p.id::text, 'position', p.position,
    'translations', pg_catalog.jsonb_build_object(
      'zh', pg_catalog.jsonb_build_object('text', COALESCE(zh.text, '')),
      'en', pg_catalog.jsonb_build_object('text', COALESCE(en.text, ''))
    )
  ) ORDER BY p.position, p.id), '[]'::jsonb)
  FROM public.resume_intro_paragraphs AS p
  LEFT JOIN public.resume_intro_paragraph_translations AS zh
    ON zh.paragraph_id = p.id AND zh.resume_id = p.resume_id AND zh.locale = 'zh'
  LEFT JOIN public.resume_intro_paragraph_translations AS en
    ON en.paragraph_id = p.id AND en.resume_id = p.resume_id AND en.locale = 'en'
  WHERE p.resume_id = target_resume_id
$function$;
REVOKE ALL ON FUNCTION cms_private.read_resume_introduction(uuid)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.save_resume_introduction(target_resume_id uuid, target_items jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  target_site_key text;
  gate_enabled boolean;
BEGIN
  IF (SELECT auth.uid()) IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;
  SELECT context.resolved_site_key INTO target_site_key
  FROM cms_private.assert_activity_log_target(target_resume_id) AS context;
  IF target_site_key IS NULL THEN
    RAISE EXCEPTION 'Introduction target is not authorized' USING ERRCODE = '42501';
  END IF;

  -- Activation/deactivation takes this same row lock. Check only after taking
  -- it so an unsigned legacy call cannot race a gate transition.
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
  IF COALESCE(gate_enabled, false) THEN
    RAISE EXCEPTION 'Signed Introduction context is required' USING ERRCODE = '42501';
  END IF;
  RETURN cms_private.apply_resume_introduction(target_resume_id, target_items, NULL);
END
$function$;

CREATE FUNCTION cms_private.verify_resume_introduction_v11_context(
  target_resume_id uuid,
  canonical_items text,
  signed_context text,
  signature_hex text
)
RETURNS TABLE (context_value jsonb, items_value jsonb)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  parsed_context jsonb;
  parsed_items jsonb;
  key_value bytea;
  provided_signature bytea;
  expected_signature bytea;
  request_digest text;
  issued_seconds bigint;
  expires_seconds bigint;
  now_seconds bigint;
  ip_text text;
  ip_value cidr;
  field_text text;
  item_value jsonb;
BEGIN
  BEGIN
    IF signed_context IS NULL OR pg_catalog.octet_length(pg_catalog.convert_to(signed_context, 'UTF8')) > 8192
      OR canonical_items IS NULL
      OR pg_catalog.octet_length(pg_catalog.convert_to(canonical_items, 'UTF8')) > 262144
      OR signature_hex IS NULL OR signature_hex !~ '^[0-9A-Fa-f]{64}$' THEN
      RAISE EXCEPTION 'Invalid signed context';
    END IF;
    parsed_context := signed_context::jsonb;
    IF pg_catalog.jsonb_typeof(parsed_context) <> 'object'
      OR (SELECT count(*) FROM pg_catalog.jsonb_object_keys(parsed_context)) <> 14
      OR pg_catalog.jsonb_typeof(parsed_context->'context_version') <> 'number'
      OR parsed_context->>'context_version' <> '1'
      OR pg_catalog.jsonb_typeof(parsed_context->'key_id') <> 'string'
      OR parsed_context->>'key_id' !~ '^[A-Za-z0-9._-]{1,64}$'
      OR pg_catalog.jsonb_typeof(parsed_context->'actor_user_id') <> 'string'
      OR pg_catalog.jsonb_typeof(parsed_context->'resume_id') <> 'string'
      OR pg_catalog.jsonb_typeof(parsed_context->'domain') <> 'string'
      OR parsed_context->>'domain' <> 'introduction'
      OR pg_catalog.jsonb_typeof(parsed_context->'operation') <> 'string'
      OR parsed_context->>'operation' <> 'update'
      OR pg_catalog.jsonb_typeof(parsed_context->'request_id') <> 'string'
      OR pg_catalog.jsonb_typeof(parsed_context->'mutation_digest') <> 'string'
      OR parsed_context->>'mutation_digest' !~ '^[0-9a-f]{64}$'
      OR pg_catalog.jsonb_typeof(parsed_context->'issued_at') <> 'number'
      OR parsed_context->>'issued_at' !~ '^[0-9]{1,12}$'
      OR pg_catalog.jsonb_typeof(parsed_context->'expires_at') <> 'number'
      OR parsed_context->>'expires_at' !~ '^[0-9]{1,12}$'
      OR EXISTS (
        SELECT 1 FROM pg_catalog.jsonb_object_keys(parsed_context) AS k(key_name)
        WHERE k.key_name <> ALL(ARRAY[
          'context_version', 'key_id', 'actor_user_id', 'resume_id', 'domain',
          'operation', 'request_id', 'mutation_digest', 'issued_at', 'expires_at',
          'ip_network', 'country_code', 'region', 'city'
        ])
      )
      OR NOT (parsed_context ? 'ip_network')
      OR NOT (parsed_context ? 'country_code')
      OR NOT (parsed_context ? 'region')
      OR NOT (parsed_context ? 'city') THEN
      RAISE EXCEPTION 'Invalid signed context';
    END IF;

    IF (parsed_context->>'actor_user_id')::uuid IS DISTINCT FROM (SELECT auth.uid())
      OR (parsed_context->>'resume_id')::uuid IS DISTINCT FROM target_resume_id
      OR (parsed_context->>'request_id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
      RAISE EXCEPTION 'Invalid signed context';
    END IF;

    issued_seconds := (parsed_context->>'issued_at')::bigint;
    expires_seconds := (parsed_context->>'expires_at')::bigint;
    now_seconds := pg_catalog.floor(pg_catalog.date_part('epoch', pg_catalog.clock_timestamp()))::bigint;
    IF issued_seconds > now_seconds + 60 OR expires_seconds <= now_seconds
      OR expires_seconds <= issued_seconds OR expires_seconds - issued_seconds > 300 THEN
      RAISE EXCEPTION 'Invalid signed context';
    END IF;

    request_digest := pg_catalog.encode(
      extensions.digest(pg_catalog.convert_to(canonical_items, 'UTF8'), 'sha256'), 'hex'
    );
    IF request_digest <> parsed_context->>'mutation_digest' THEN
      RAISE EXCEPTION 'Invalid signed context';
    END IF;

    provided_signature := pg_catalog.decode(signature_hex, 'hex');
    key_value := cms_private.activity_log_v11_key(parsed_context->>'key_id');
    IF key_value IS NULL OR pg_catalog.octet_length(key_value) < 32 THEN
      RAISE EXCEPTION 'Invalid signed context';
    END IF;
    expected_signature := extensions.hmac(
      pg_catalog.convert_to(signed_context, 'UTF8'), key_value, 'sha256'
    );
    -- PostgreSQL bytea equality is not documented as constant-time. Keep the
    -- digest fixed length and all failures generic; do not claim CT behavior.
    IF provided_signature <> expected_signature THEN
      RAISE EXCEPTION 'Invalid signed context';
    END IF;

    IF parsed_context->'ip_network' <> 'null'::jsonb THEN
      IF pg_catalog.jsonb_typeof(parsed_context->'ip_network') <> 'string' THEN
        RAISE EXCEPTION 'Invalid signed context';
      END IF;
      ip_text := parsed_context->>'ip_network';
      ip_value := ip_text::cidr;
      IF ip_value::text <> ip_text OR NOT (
        (pg_catalog.family(ip_value) = 4 AND pg_catalog.masklen(ip_value) = 24) OR
        (pg_catalog.family(ip_value) = 6 AND pg_catalog.masklen(ip_value) = 48)
      ) THEN
        RAISE EXCEPTION 'Invalid signed context';
      END IF;
    END IF;

    field_text := parsed_context->>'country_code';
    IF parsed_context->'country_code' <> 'null'::jsonb
      AND (pg_catalog.jsonb_typeof(parsed_context->'country_code') <> 'string'
        OR field_text COLLATE "C" !~ '^[A-Z]{2}$') THEN
      RAISE EXCEPTION 'Invalid signed context';
    END IF;
    FOREACH field_text IN ARRAY ARRAY['region', 'city'] LOOP
      IF parsed_context->field_text <> 'null'::jsonb THEN
        IF pg_catalog.jsonb_typeof(parsed_context->field_text) <> 'string'
          OR pg_catalog.octet_length(parsed_context->>field_text) NOT BETWEEN 1 AND 128
          OR (parsed_context->>field_text) ~ '[[:cntrl:]]' THEN
          RAISE EXCEPTION 'Invalid signed context';
        END IF;
      END IF;
    END LOOP;

    parsed_items := canonical_items::jsonb;
    IF pg_catalog.jsonb_typeof(parsed_items) <> 'array'
      OR pg_catalog.jsonb_array_length(parsed_items) > 200
      OR EXISTS (
        SELECT 1 FROM pg_catalog.jsonb_array_elements(parsed_items) AS e(value)
        WHERE pg_catalog.jsonb_typeof(e.value) <> 'object'
          OR (SELECT count(*) FROM pg_catalog.jsonb_object_keys(e.value)) <> 3
          OR NOT (e.value ? 'id') OR NOT (e.value ? 'zh') OR NOT (e.value ? 'en')
          OR pg_catalog.jsonb_typeof(e.value->'id') NOT IN ('string', 'null')
          OR pg_catalog.jsonb_typeof(e.value->'zh') <> 'string'
          OR pg_catalog.jsonb_typeof(e.value->'en') <> 'string'
          OR pg_catalog.length(e.value->>'zh') > 12000
          OR pg_catalog.length(e.value->>'en') > 12000
          OR (e.value->>'id' IS NOT NULL AND pg_catalog.octet_length(e.value->>'id') > 64)
          OR (e.value->>'id' IS NOT NULL
            AND e.value->>'id' !~ '^local-[0-9]+-[0-9]+$'
            AND e.value->>'id' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
      )
      OR EXISTS (
        SELECT 1 FROM (
          SELECT e.value->>'id' AS item_id
          FROM pg_catalog.jsonb_array_elements(parsed_items) AS e(value)
          WHERE e.value->>'id' IS NOT NULL AND e.value->>'id' NOT LIKE 'local-%'
          GROUP BY e.value->>'id' HAVING count(*) > 1
        ) AS duplicates
      ) THEN
      RAISE EXCEPTION 'Invalid signed context';
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'Invalid signed Introduction request' USING ERRCODE = '22023';
  END;

  context_value := parsed_context;
  items_value := parsed_items;
  RETURN NEXT;
END
$function$;
REVOKE ALL ON FUNCTION cms_private.verify_resume_introduction_v11_context(uuid, text, text, text)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.load_admin_feature_state_v11(target_resume_id uuid)
RETURNS TABLE (
  activity_log_enabled boolean,
  introduction_write_mode text,
  introduction_trusted_context_required boolean
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  IF (SELECT auth.uid()) IS NULL OR NOT public.can_manage_resume(target_resume_id) THEN
    RAISE EXCEPTION 'Admin target is not authorized' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY SELECT
    COALESCE((SELECT capability.enabled FROM cms_private.resume_capabilities AS capability
      WHERE capability.resume_id = target_resume_id AND capability.capability_key = 'activity_log'), false),
    cms_private.get_resume_write_mode(target_resume_id, 'introduction'),
    COALESCE((SELECT requirement.enabled FROM cms_private.resume_domain_requirements AS requirement
      WHERE requirement.resume_id = target_resume_id
        AND requirement.domain_key = 'introduction'
        AND requirement.requirement_key = 'trusted_network_context_v11'), false);
END
$function$;

CREATE FUNCTION public.save_resume_introduction_v11(
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
    IF existing_digest <> request_digest OR existing_completed_at IS NULL OR existing_result IS NULL THEN
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

REVOKE ALL ON FUNCTION public.save_resume_introduction(uuid, jsonb)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.save_resume_introduction(uuid, jsonb) TO authenticated;
REVOKE ALL ON FUNCTION public.load_admin_feature_state_v11(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.load_admin_feature_state_v11(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.save_resume_introduction_v11(uuid, text, text, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.save_resume_introduction_v11(uuid, text, text, text) TO authenticated;
REVOKE ALL ON FUNCTION cms_private.apply_resume_introduction(uuid, jsonb, jsonb)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION cms_private.read_resume_introduction(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION cms_private.verify_resume_introduction_v11_context(uuid, text, text, text)
  FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON TABLE cms_private.resume_domain_requirements IS
  'Private per-resume/per-domain requirements. Missing rows are disabled; any future activation/deactivation must lock the same resume_sites row before changing a requirement.';
COMMENT ON TABLE cms_private.activity_log_idempotency IS
  'Private seven-day request deduplication state with bounded canonical response replay; contains no signing material.';
COMMENT ON FUNCTION cms_private.activity_log_v11_key(text) IS
  'Fail-closed key-provider boundary. Production Vault adapter is not included in the V1.1 local foundation.';
COMMENT ON FUNCTION public.save_resume_introduction_v11(uuid, text, text, text) IS
  'V1.1 signed-context Introduction writer. Requires an enabled target/domain requirement and never uses service_role.';

COMMIT;
