-- TEST ONLY: verify the production Test-routing migration's target-specific settings.
BEGIN;
SELECT extensions.plan(3);

DO $target_identity$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.resume_sites
      WHERE id = 'ea111111-1111-4111-8111-111111111111'
        AND site_key = 'example-cv-qa-activity-log' AND is_published IS FALSE)
    OR NOT EXISTS (SELECT 1 FROM public.resume_sites
      WHERE id = '20000000-0000-4000-8000-000000000001' AND site_key = 'example-cv') THEN
    RAISE EXCEPTION 'The isolated Owner and official Test target fixtures are required';
  END IF;
END
$target_identity$;

SELECT set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000002', true);
SELECT set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000002","role":"authenticated","email":"qa@example.test"}', true);
SET LOCAL ROLE authenticated;
SELECT extensions.ok((SELECT education_write_mode = 'rpc' AND education_trusted_context_required
    FROM public.load_admin_education_write_state('ea111111-1111-4111-8111-111111111111')),
  'official Test Education mode is RPC with trusted context enabled');
SELECT extensions.ok((SELECT experience_write_mode = 'rpc' AND experience_trusted_context_required
    FROM public.load_admin_experience_write_state('ea111111-1111-4111-8111-111111111111')),
  'official Test Experience mode is RPC with trusted context enabled');

RESET ROLE;
SELECT set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', true);
SELECT set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000001","role":"authenticated","email":"owner@example.test"}', true);
SET LOCAL ROLE authenticated;
SELECT extensions.ok((SELECT education_write_mode = 'direct'
    FROM public.load_admin_education_write_state('20000000-0000-4000-8000-000000000001'))
  AND (SELECT experience_write_mode = 'direct'
    FROM public.load_admin_experience_write_state('20000000-0000-4000-8000-000000000001')),
  'Owner Education and Experience remain in direct mode');

ROLLBACK;
