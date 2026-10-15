BEGIN;
SELECT plan(4);

SELECT ok(
  to_regprocedure('public.verify_test_profile_signing_probe_v1(text,text)') IS NULL,
  'temporary signing-probe function is absent after the retirement migration'
);

SELECT ok(
  to_regprocedure('cms_private.activity_log_v11_key(text)') IS NOT NULL,
  'shared Activity Log signing-key provider remains installed'
);

SELECT ok(
  to_regprocedure('public.save_resume_profile_v1(uuid,text,text,text)') IS NOT NULL,
  'normal signed Profile Save RPC remains installed'
);

SELECT ok(
  has_function_privilege(
    'authenticated',
    'public.save_resume_profile_v1(uuid,text,text,text)',
    'EXECUTE'
  ),
  'authenticated Profile Save execution grant remains installed'
);

SELECT * FROM finish();
ROLLBACK;
