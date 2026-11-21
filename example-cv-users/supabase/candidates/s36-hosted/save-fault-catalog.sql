-- Included within an already target-checked transaction. An absent or unexpected object is an error.
SELECT set_config('s36_test.body_sha', :'body_sha', true) AS body_sha
\gset
DO $object$
DECLARE f pg_proc; t pg_trigger;
BEGIN
  SELECT * INTO STRICT f FROM pg_proc WHERE oid='site_private.s36_test_abort_save()'::regprocedure;
  SELECT * INTO STRICT t FROM pg_trigger
    WHERE tgrelid='site_private.text_publication_audit'::regclass AND tgname='s36_test_abort_save';
  IF f.proowner<>'ecv_s3_integrity'::regrole OR NOT f.prosecdef OR f.prorettype<>'trigger'::regtype
     OR f.proconfig IS DISTINCT FROM ARRAY['search_path=""']
     OR encode(sha256(convert_to(f.prosrc,'UTF8')),'hex')<>current_setting('s36_test.body_sha')
     OR EXISTS(SELECT FROM aclexplode(coalesce(f.proacl,acldefault('f',f.proowner))) a WHERE a.grantee<>f.proowner)
     OR t.tgfoid<>f.oid OR t.tgtype<>5 OR NOT t.tgdeferrable OR NOT t.tginitdeferred
     OR t.tgenabled<>'O' OR t.tgqual IS NOT NULL OR t.tgnargs<>0 OR t.tgconstraint=0 OR t.tgisinternal
     OR (SELECT count(*) FROM pg_trigger WHERE tgfoid=f.oid OR tgname='s36_test_abort_save')<>1

  THEN RAISE EXCEPTION 'S36_FAULT_OBJECT_DRIFT'; END IF;
END;
$object$;
