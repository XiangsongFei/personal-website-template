-- D-8: purpose-specific authenticated Storage authorization for resume PDFs.
-- Installing this migration does not activate any resume. A row in the private
-- protocol table is required before the intent-only Storage rules apply.
BEGIN;

DO $owner$
BEGIN
  IF current_user <> 'postgres' THEN
    RAISE EXCEPTION 'Files Storage authorization must be installed as postgres' USING ERRCODE='42501';
  END IF;
END
$owner$;

CREATE TABLE cms_private.resume_files_storage_protocol (
  resume_id uuid PRIMARY KEY REFERENCES public.resume_sites(id) ON DELETE CASCADE,
  protocol_key text NOT NULL CHECK (protocol_key='intent_v1'),
  configured_at timestamptz NOT NULL DEFAULT transaction_timestamp()
);
ALTER TABLE cms_private.resume_files_storage_protocol ENABLE ROW LEVEL SECURITY;
ALTER TABLE cms_private.resume_files_storage_protocol FORCE ROW LEVEL SECURITY;
REVOKE ALL ON cms_private.resume_files_storage_protocol FROM PUBLIC,anon,authenticated,service_role;

CREATE TABLE cms_private.resume_file_upload_intents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id uuid NOT NULL,
  resume_id uuid NOT NULL REFERENCES public.resume_sites(id) ON DELETE CASCADE,
  locale text NOT NULL CHECK (locale IN ('zh','en')),
  request_id uuid NOT NULL,
  mutation_digest bytea NOT NULL CHECK (octet_length(mutation_digest)=32),
  byte_size integer NOT NULL CHECK (byte_size BETWEEN 1 AND 10485760),
  object_name text NOT NULL UNIQUE,
  status text NOT NULL CHECK (status IN ('prepared','uploaded','consumed','cleanup_pending','cleaned')),
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  expires_at timestamptz NOT NULL,
  completed_at timestamptz,
  UNIQUE(actor_user_id,resume_id,request_id),
  CHECK ((status IN ('uploaded','consumed') AND completed_at IS NOT NULL) OR status NOT IN ('uploaded','consumed'))
);
ALTER TABLE cms_private.resume_file_upload_intents ENABLE ROW LEVEL SECURITY;
ALTER TABLE cms_private.resume_file_upload_intents FORCE ROW LEVEL SECURITY;
REVOKE ALL ON cms_private.resume_file_upload_intents FROM PUBLIC,anon,authenticated,service_role;

CREATE TABLE cms_private.resume_file_cleanup_intents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id uuid NOT NULL,
  resume_id uuid NOT NULL REFERENCES public.resume_sites(id) ON DELETE CASCADE,
  object_name text NOT NULL,
  purpose text NOT NULL CHECK (purpose IN ('superseded','rejected_upload')),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','claimed','completed')),
  claim_id uuid,
  lease_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  completed_at timestamptz,
  UNIQUE(resume_id,object_name),
  CHECK ((status='claimed')=(claim_id IS NOT NULL AND lease_until IS NOT NULL))
);
ALTER TABLE cms_private.resume_file_cleanup_intents ENABLE ROW LEVEL SECURITY;
ALTER TABLE cms_private.resume_file_cleanup_intents FORCE ROW LEVEL SECURITY;
REVOKE ALL ON cms_private.resume_file_cleanup_intents FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION cms_private.files_storage_intent_mode(target_resume_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=''
AS $f$ SELECT EXISTS(SELECT 1 FROM cms_private.resume_files_storage_protocol p WHERE p.resume_id=target_resume_id AND p.protocol_key='intent_v1') $f$;
REVOKE ALL ON FUNCTION cms_private.files_storage_intent_mode(uuid) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.resolve_admin_files_storage_target_v1()
RETURNS uuid LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=''
AS $f$
DECLARE target_count integer; resolved_id uuid;
BEGIN
  IF (SELECT auth.uid()) IS NULL THEN RAISE EXCEPTION 'Authentication required' USING ERRCODE='42501'; END IF;
  SELECT count(*),(pg_catalog.array_agg(t.resume_id ORDER BY t.resume_id))[1] INTO target_count,resolved_id
  FROM public.activity_log_authorized_targets() t
  JOIN cms_private.resume_files_storage_protocol p ON p.resume_id=t.resume_id AND p.protocol_key='intent_v1'
  WHERE cms_private.get_resume_write_mode(t.resume_id,'files')='rpc'
    AND COALESCE((SELECT r.enabled FROM cms_private.resume_domain_requirements r WHERE r.resume_id=t.resume_id
      AND r.domain_key='files' AND r.requirement_key='trusted_network_context_v11'),false)
    AND COALESCE((SELECT c.enabled FROM cms_private.resume_capabilities c WHERE c.resume_id=t.resume_id AND c.capability_key='activity_log'),false);
  IF target_count<>1 OR resolved_id IS NULL THEN RAISE EXCEPTION 'Files Storage target is unavailable or ambiguous' USING ERRCODE='42501'; END IF;
  RETURN resolved_id;
END
$f$;
REVOKE ALL ON FUNCTION public.resolve_admin_files_storage_target_v1() FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.resolve_admin_files_storage_target_v1() TO authenticated;

CREATE FUNCTION public.load_admin_files_storage_state_v1(target_resume_id uuid)
RETURNS TABLE(resume_id uuid,activity_log_enabled boolean,files_write_mode text,files_trusted_context_required boolean,storage_protocol text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=''
AS $f$
BEGIN
  IF (SELECT auth.uid()) IS NULL OR NOT public.can_manage_resume(target_resume_id) THEN
    RAISE EXCEPTION 'Admin Files target is not authorized' USING ERRCODE='42501';
  END IF;
  RETURN QUERY SELECT target_resume_id,
    COALESCE((SELECT c.enabled FROM cms_private.resume_capabilities c WHERE c.resume_id=target_resume_id AND c.capability_key='activity_log'),false),
    cms_private.get_resume_write_mode(target_resume_id,'files'),
    COALESCE((SELECT r.enabled FROM cms_private.resume_domain_requirements r WHERE r.resume_id=target_resume_id
      AND r.domain_key='files' AND r.requirement_key='trusted_network_context_v11'),false),
    COALESCE((SELECT p.protocol_key FROM cms_private.resume_files_storage_protocol p WHERE p.resume_id=target_resume_id),'legacy'::text);
END
$f$;
REVOKE ALL ON FUNCTION public.load_admin_files_storage_state_v1(uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.load_admin_files_storage_state_v1(uuid) TO authenticated;

CREATE FUNCTION public.prepare_resume_file_upload_v1(
  target_resume_id uuid,target_locale text,target_request_id uuid,candidate_object_name text,
  target_byte_size integer,target_content_sha256 text,canonical_upload text,signed_context text,signature_hex text
)
RETURNS TABLE(object_name text,upload_status text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $f$
DECLARE ctx jsonb; prior cms_private.resume_file_upload_intents%ROWTYPE; resolved_id uuid; expected_body text;
BEGIN
  resolved_id := public.resolve_admin_files_storage_target_v1();
  IF resolved_id IS DISTINCT FROM target_resume_id OR (SELECT auth.uid()) IS NULL OR target_resume_id IS NULL OR target_locale IS NULL OR target_locale NOT IN ('zh','en') OR target_request_id IS NULL
    OR target_byte_size IS NULL OR target_byte_size NOT BETWEEN 1 AND 10485760 OR target_content_sha256 IS NULL OR target_content_sha256 !~ '^[0-9a-f]{64}$'
    OR candidate_object_name IS NULL OR candidate_object_name !~* ('^'||target_resume_id::text||'/'||target_locale||'/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.pdf$')
    OR NOT public.can_manage_resume(target_resume_id) OR NOT cms_private.files_storage_intent_mode(target_resume_id)
    OR cms_private.get_resume_write_mode(target_resume_id,'files')<>'rpc'
    OR NOT COALESCE((SELECT r.enabled FROM cms_private.resume_domain_requirements r WHERE r.resume_id=target_resume_id
      AND r.domain_key='files' AND r.requirement_key='trusted_network_context_v11'),false)
    OR NOT COALESCE((SELECT c.enabled FROM cms_private.resume_capabilities c WHERE c.resume_id=target_resume_id AND c.capability_key='activity_log'),false) THEN
    RAISE EXCEPTION 'Files upload is not authorized' USING ERRCODE='42501';
  END IF;
  expected_body := '{"byte_size":'||target_byte_size::text||',"content_sha256":"'||target_content_sha256||'","locale":"'||target_locale||'","request_id":"'||target_request_id::text||'","resume_id":"'||target_resume_id::text||'","version":1}';
  IF canonical_upload IS DISTINCT FROM expected_body THEN RAISE EXCEPTION 'Invalid Files upload request' USING ERRCODE='22023'; END IF;
  ctx := cms_private.verify_resume_d7_v1_context(target_resume_id,'files',canonical_upload,signed_context,signature_hex);
  IF (ctx->>'request_id')::uuid IS DISTINCT FROM target_request_id OR (ctx->>'actor_user_id')::uuid IS DISTINCT FROM (SELECT auth.uid()) THEN
    RAISE EXCEPTION 'Invalid Files upload identity' USING ERRCODE='42501';
  END IF;
  SELECT i.* INTO prior FROM cms_private.resume_file_upload_intents i
   WHERE i.actor_user_id=(SELECT auth.uid()) AND i.resume_id=target_resume_id AND i.request_id=target_request_id FOR UPDATE;
  IF FOUND THEN
    IF prior.mutation_digest<>decode(target_content_sha256,'hex') OR prior.byte_size<>target_byte_size OR prior.locale<>target_locale THEN
      RAISE EXCEPTION 'Files upload request conflicts' USING ERRCODE='P13B1';
    END IF;
    IF prior.status='prepared' AND prior.expires_at<=clock_timestamp() THEN
      RETURN QUERY SELECT prior.object_name,'expired'::text; RETURN;
    END IF;
    RETURN QUERY SELECT prior.object_name,prior.status; RETURN;
  END IF;
  INSERT INTO cms_private.resume_file_upload_intents(actor_user_id,resume_id,locale,request_id,mutation_digest,byte_size,object_name,status,expires_at)
  VALUES((SELECT auth.uid()),target_resume_id,target_locale,target_request_id,decode(target_content_sha256,'hex'),target_byte_size,candidate_object_name,'prepared',clock_timestamp()+interval '5 minutes');
  RETURN QUERY SELECT candidate_object_name,'prepared'::text;
END
$f$;
REVOKE ALL ON FUNCTION public.prepare_resume_file_upload_v1(uuid,text,uuid,text,integer,text,text,text,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.prepare_resume_file_upload_v1(uuid,text,uuid,text,integer,text,text,text,text) TO authenticated;

CREATE FUNCTION public.complete_resume_file_upload_v1(target_resume_id uuid,target_request_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $f$
DECLARE intent cms_private.resume_file_upload_intents%ROWTYPE; resolved_id uuid;
BEGIN
  resolved_id := public.resolve_admin_files_storage_target_v1();
  SELECT i.* INTO intent FROM cms_private.resume_file_upload_intents i WHERE i.resume_id=target_resume_id
    AND i.request_id=target_request_id AND i.actor_user_id=(SELECT auth.uid()) FOR UPDATE;
  IF NOT FOUND OR resolved_id IS DISTINCT FROM target_resume_id OR NOT cms_private.files_storage_intent_mode(target_resume_id) OR NOT public.can_manage_resume(target_resume_id) THEN
    RAISE EXCEPTION 'Files upload intent not found' USING ERRCODE='42501';
  END IF;
  IF intent.status IN ('uploaded','consumed') THEN RETURN true; END IF;
  IF intent.status<>'prepared' OR intent.expires_at<=clock_timestamp() THEN
    RAISE EXCEPTION 'Files upload intent expired' USING ERRCODE='22023';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM storage.objects o WHERE o.bucket_id='resume-files' AND o.name=intent.object_name) THEN
    RAISE EXCEPTION 'Files upload object is not present' USING ERRCODE='22023';
  END IF;
  UPDATE cms_private.resume_file_upload_intents SET status='uploaded',completed_at=transaction_timestamp() WHERE id=intent.id;
  RETURN true;
END
$f$;
REVOKE ALL ON FUNCTION public.complete_resume_file_upload_v1(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.complete_resume_file_upload_v1(uuid,uuid) TO authenticated;

CREATE FUNCTION cms_private.files_managed_object_name(target_resume_id uuid,target_locale text,target_reference text)
RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=''
AS $f$
DECLARE origin text; result text;
BEGIN
  SELECT c.origin INTO origin FROM cms_private.profile_photo_origin_config c WHERE c.singleton;
  IF (SELECT count(*) FROM cms_private.profile_photo_origin_config)<>1 OR NOT cms_private.files_reference_is_allowed(origin,target_resume_id,target_locale,target_reference) THEN RETURN NULL; END IF;
  result := target_resume_id::text||'/'||target_locale||'/'||pg_catalog.regexp_replace(target_reference,'^.*/','');
  IF result !~* ('^'||target_resume_id::text||'/'||target_locale||'/[0-9a-f-]{36}\.pdf$') THEN RETURN NULL; END IF;
  RETURN result;
END
$f$;
REVOKE ALL ON FUNCTION cms_private.files_managed_object_name(uuid,text,text) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION cms_private.enforce_resume_file_upload_intent()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $f$
DECLARE managed_object_name text; intent_id uuid;
BEGIN
  IF NEW.portfolio_href IS NOT DISTINCT FROM OLD.portfolio_href OR NOT cms_private.files_storage_intent_mode(NEW.resume_id) THEN RETURN NEW; END IF;
  managed_object_name := cms_private.files_managed_object_name(NEW.resume_id,NEW.locale,NEW.portfolio_href);
  IF managed_object_name IS NULL THEN RETURN NEW; END IF; -- verified legacy restoration is governed by the D-7 restore RPC.
  IF EXISTS(SELECT 1 FROM cms_private.resume_file_cleanup_intents c WHERE c.resume_id=NEW.resume_id AND c.object_name=managed_object_name AND c.status<>'completed') THEN
    RAISE EXCEPTION 'Files object is reserved for cleanup' USING ERRCODE='42501';
  END IF;
  SELECT i.id INTO intent_id FROM cms_private.resume_file_upload_intents i WHERE i.actor_user_id=(SELECT auth.uid())
    AND i.resume_id=NEW.resume_id AND i.locale=NEW.locale AND i.object_name=managed_object_name AND i.status='uploaded' FOR UPDATE;
  IF intent_id IS NULL THEN RAISE EXCEPTION 'Files object has no completed upload authorization' USING ERRCODE='42501'; END IF;
  UPDATE cms_private.resume_file_upload_intents SET status='consumed' WHERE id=intent_id;
  RETURN NEW;
END
$f$;
REVOKE ALL ON FUNCTION cms_private.enforce_resume_file_upload_intent() FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION cms_private.record_superseded_resume_file_cleanup()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $f$
DECLARE old_object text;
BEGIN
  IF OLD.portfolio_href IS NOT DISTINCT FROM NEW.portfolio_href OR NOT cms_private.files_storage_intent_mode(NEW.resume_id) THEN RETURN NEW; END IF;
  old_object := cms_private.files_managed_object_name(OLD.resume_id,OLD.locale,OLD.portfolio_href);
  IF old_object IS NOT NULL THEN
    INSERT INTO cms_private.resume_file_cleanup_intents(actor_user_id,resume_id,object_name,purpose)
    VALUES((SELECT auth.uid()),OLD.resume_id,old_object,'superseded')
    ON CONFLICT(resume_id,object_name) DO NOTHING;
  END IF;
  RETURN NEW;
END
$f$;
REVOKE ALL ON FUNCTION cms_private.record_superseded_resume_file_cleanup() FROM PUBLIC,anon,authenticated,service_role;

DROP TRIGGER IF EXISTS cms_resume_file_upload_intent_guard ON public.resume_locale_content;
CREATE TRIGGER cms_resume_file_upload_intent_guard BEFORE UPDATE OF portfolio_href ON public.resume_locale_content
FOR EACH ROW EXECUTE FUNCTION cms_private.enforce_resume_file_upload_intent();
DROP TRIGGER IF EXISTS cms_resume_file_cleanup_queue ON public.resume_locale_content;
CREATE TRIGGER cms_resume_file_cleanup_queue AFTER UPDATE OF portfolio_href ON public.resume_locale_content
FOR EACH ROW EXECUTE FUNCTION cms_private.record_superseded_resume_file_cleanup();

CREATE FUNCTION public.request_resume_file_candidate_cleanup_v1(target_resume_id uuid,target_request_ids uuid[])
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $f$
DECLARE item record; inserted_count integer:=0; resolved_id uuid;
BEGIN
  resolved_id := public.resolve_admin_files_storage_target_v1();
  IF resolved_id IS DISTINCT FROM target_resume_id OR (SELECT auth.uid()) IS NULL OR NOT public.can_manage_resume(target_resume_id) OR NOT cms_private.files_storage_intent_mode(target_resume_id)
    OR target_request_ids IS NULL OR cardinality(target_request_ids)>2 THEN RAISE EXCEPTION 'Files cleanup is not authorized' USING ERRCODE='42501'; END IF;
  FOR item IN SELECT i.* FROM cms_private.resume_file_upload_intents i WHERE i.actor_user_id=(SELECT auth.uid()) AND i.resume_id=target_resume_id
    AND i.request_id=ANY(target_request_ids) AND i.status IN ('prepared','uploaded') FOR UPDATE LOOP
    IF NOT EXISTS(SELECT 1 FROM public.resume_locale_content l WHERE l.resume_id=target_resume_id AND l.portfolio_href=
      (SELECT c.origin FROM cms_private.profile_photo_origin_config c WHERE c.singleton)||'/storage/v1/object/public/resume-files/'||item.object_name) THEN
      INSERT INTO cms_private.resume_file_cleanup_intents(actor_user_id,resume_id,object_name,purpose)
      VALUES((SELECT auth.uid()),target_resume_id,item.object_name,'rejected_upload') ON CONFLICT(resume_id,object_name) DO NOTHING;
      UPDATE cms_private.resume_file_upload_intents SET status='cleanup_pending' WHERE id=item.id;
      inserted_count:=inserted_count+1;
    END IF;
  END LOOP;
  RETURN inserted_count;
END
$f$;
REVOKE ALL ON FUNCTION public.request_resume_file_candidate_cleanup_v1(uuid,uuid[]) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.request_resume_file_candidate_cleanup_v1(uuid,uuid[]) TO authenticated;

CREATE FUNCTION public.claim_resume_file_cleanup_v1(target_resume_id uuid,target_claim_id uuid)
RETURNS TABLE(cleanup_id uuid,object_name text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $f$
DECLARE resolved_id uuid;
BEGIN
  resolved_id := public.resolve_admin_files_storage_target_v1();
  IF resolved_id IS DISTINCT FROM target_resume_id OR (SELECT auth.uid()) IS NULL OR NOT public.can_manage_resume(target_resume_id) OR NOT cms_private.files_storage_intent_mode(target_resume_id) OR target_claim_id IS NULL THEN
    RAISE EXCEPTION 'Files cleanup is not authorized' USING ERRCODE='42501';
  END IF;
  RETURN QUERY
  WITH available AS (
    SELECT c.id FROM cms_private.resume_file_cleanup_intents c
    WHERE c.resume_id=target_resume_id AND c.actor_user_id=(SELECT auth.uid())
      AND (c.status='pending' OR (c.status='claimed' AND c.lease_until<clock_timestamp()))
      AND NOT EXISTS(SELECT 1 FROM public.resume_locale_content l WHERE l.resume_id=c.resume_id AND l.portfolio_href=
        (SELECT x.origin FROM cms_private.profile_photo_origin_config x WHERE x.singleton)||'/storage/v1/object/public/resume-files/'||c.object_name)
    ORDER BY c.created_at,c.id FOR UPDATE SKIP LOCKED
  ), changed AS (
    UPDATE cms_private.resume_file_cleanup_intents c SET status='claimed',claim_id=target_claim_id,lease_until=clock_timestamp()+interval '2 minutes'
    FROM available a WHERE c.id=a.id RETURNING c.id,c.object_name
  ) SELECT changed.id,changed.object_name FROM changed;
END
$f$;
REVOKE ALL ON FUNCTION public.claim_resume_file_cleanup_v1(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.claim_resume_file_cleanup_v1(uuid,uuid) TO authenticated;

CREATE FUNCTION public.complete_resume_file_cleanup_v1(target_resume_id uuid,target_cleanup_id uuid,target_claim_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $f$
DECLARE affected integer; resolved_id uuid;
BEGIN
  resolved_id := public.resolve_admin_files_storage_target_v1();
  IF resolved_id IS DISTINCT FROM target_resume_id THEN RAISE EXCEPTION 'Files cleanup target is not authorized' USING ERRCODE='42501'; END IF;
  UPDATE cms_private.resume_file_cleanup_intents SET status='completed',completed_at=transaction_timestamp(),claim_id=NULL,lease_until=NULL
  WHERE id=target_cleanup_id AND resume_id=target_resume_id AND actor_user_id=(SELECT auth.uid()) AND status='claimed' AND claim_id=target_claim_id
    AND NOT EXISTS(SELECT 1 FROM public.resume_locale_content l WHERE l.resume_id=target_resume_id AND l.portfolio_href=
      (SELECT x.origin FROM cms_private.profile_photo_origin_config x WHERE x.singleton)||'/storage/v1/object/public/resume-files/'||object_name);
  GET DIAGNOSTICS affected=ROW_COUNT;
  IF affected<>1 THEN RAISE EXCEPTION 'Files cleanup completion was not authorized' USING ERRCODE='42501'; END IF;
  UPDATE cms_private.resume_file_upload_intents i SET status='cleaned'
  WHERE i.resume_id=target_resume_id AND i.object_name=(SELECT c.object_name FROM cms_private.resume_file_cleanup_intents c WHERE c.id=target_cleanup_id)
    AND i.status='cleanup_pending';
  RETURN true;
END
$f$;
REVOKE ALL ON FUNCTION public.complete_resume_file_cleanup_v1(uuid,uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.complete_resume_file_cleanup_v1(uuid,uuid,uuid) TO authenticated;

CREATE FUNCTION public.can_insert_resume_file_object(target_bucket text,target_name text)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=''
AS $f$
DECLARE target_resume_id uuid;
BEGIN
  IF target_bucket<>'resume-files' OR target_name IS NULL THEN RETURN false; END IF;
  IF pg_catalog.split_part(target_name,'/',1) !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    THEN RETURN public.can_manage_resume_storage_object(target_bucket,target_name); END IF;
  BEGIN target_resume_id:=pg_catalog.split_part(target_name,'/',1)::uuid; EXCEPTION WHEN OTHERS THEN RETURN false; END;
  IF NOT cms_private.files_storage_intent_mode(target_resume_id) THEN RETURN public.can_manage_resume_storage_object(target_bucket,target_name); END IF;
  RETURN EXISTS(SELECT 1 FROM cms_private.resume_file_upload_intents i WHERE i.actor_user_id=(SELECT auth.uid()) AND i.resume_id=target_resume_id
    AND i.object_name=target_name AND i.status='prepared' AND i.expires_at>clock_timestamp() AND public.can_manage_resume(target_resume_id));
END
$f$;
REVOKE ALL ON FUNCTION public.can_insert_resume_file_object(text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.can_insert_resume_file_object(text,text) TO authenticated;

CREATE FUNCTION public.can_update_resume_file_object(target_bucket text,target_name text)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=''
AS $f$
DECLARE target_resume_id uuid;
BEGIN
 IF target_bucket<>'resume-files' OR target_name IS NULL THEN RETURN false; END IF;
 IF pg_catalog.split_part(target_name,'/',1) !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
   THEN RETURN public.can_manage_resume_storage_object(target_bucket,target_name); END IF;
 BEGIN target_resume_id:=pg_catalog.split_part(target_name,'/',1)::uuid; EXCEPTION WHEN OTHERS THEN RETURN false; END;
 IF cms_private.files_storage_intent_mode(target_resume_id) THEN RETURN false; END IF;
 RETURN public.can_manage_resume_storage_object(target_bucket,target_name);
END
$f$;
REVOKE ALL ON FUNCTION public.can_update_resume_file_object(text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.can_update_resume_file_object(text,text) TO authenticated;

CREATE FUNCTION public.can_delete_resume_file_object(target_bucket text,target_name text)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=''
AS $f$
DECLARE target_resume_id uuid;
BEGIN
  IF target_bucket<>'resume-files' OR target_name IS NULL THEN RETURN false; END IF;
  IF pg_catalog.split_part(target_name,'/',1) !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    THEN RETURN public.can_manage_resume_storage_object(target_bucket,target_name); END IF;
  BEGIN target_resume_id:=pg_catalog.split_part(target_name,'/',1)::uuid; EXCEPTION WHEN OTHERS THEN RETURN false; END;
  IF NOT cms_private.files_storage_intent_mode(target_resume_id) THEN RETURN public.can_manage_resume_storage_object(target_bucket,target_name); END IF;
  RETURN EXISTS(SELECT 1 FROM cms_private.resume_file_cleanup_intents c WHERE c.actor_user_id=(SELECT auth.uid()) AND c.resume_id=target_resume_id
    AND c.object_name=target_name AND c.status IN ('pending','claimed') AND public.can_manage_resume(target_resume_id)
    AND NOT EXISTS(SELECT 1 FROM public.resume_locale_content l WHERE l.resume_id=target_resume_id AND l.portfolio_href=
      (SELECT x.origin FROM cms_private.profile_photo_origin_config x WHERE x.singleton)||'/storage/v1/object/public/resume-files/'||target_name));
END
$f$;
REVOKE ALL ON FUNCTION public.can_delete_resume_file_object(text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.can_delete_resume_file_object(text,text) TO authenticated;

DROP POLICY IF EXISTS cms_admin_scoped_resume_files_insert ON storage.objects;
DROP POLICY IF EXISTS cms_admin_scoped_resume_files_update ON storage.objects;
DROP POLICY IF EXISTS cms_admin_scoped_resume_files_delete ON storage.objects;
CREATE POLICY cms_admin_scoped_resume_files_insert ON storage.objects AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (bucket_id='resume-files' AND public.can_insert_resume_file_object(bucket_id,name));
CREATE POLICY cms_admin_scoped_resume_files_update ON storage.objects AS PERMISSIVE FOR UPDATE TO authenticated
  USING (bucket_id='resume-files' AND public.can_update_resume_file_object(bucket_id,name))
  WITH CHECK (bucket_id='resume-files' AND public.can_update_resume_file_object(bucket_id,name));
CREATE POLICY cms_admin_scoped_resume_files_delete ON storage.objects AS PERMISSIVE FOR DELETE TO authenticated
  USING (bucket_id='resume-files' AND public.can_delete_resume_file_object(bucket_id,name));

COMMIT;
