-- TEST ONLY: re-key the disposable QA root before the matching production
-- routing migration runs. The seed fixture accepts this already-renamed root.
DO $test_target_fixture$
DECLARE
  qa_id CONSTANT uuid := 'ea111111-1111-4111-8111-111111111111';
BEGIN
  IF current_user <> 'postgres' THEN
    RAISE EXCEPTION 'Local Test target fixture must be prepared as postgres'
      USING ERRCODE = '42501';
  END IF;

  UPDATE public.resume_sites
     SET site_key = 'example-cv-qa-activity-log'
   WHERE id = qa_id AND site_key = 'example-cv-qa' AND is_published IS FALSE;

  IF NOT FOUND AND NOT EXISTS (
    SELECT 1 FROM public.resume_sites
     WHERE id = qa_id AND site_key = 'example-cv-qa-activity-log' AND is_published IS FALSE
  ) THEN
    RAISE EXCEPTION 'Disposable Test target could not be re-keyed safely';
  END IF;
END
$test_target_fixture$;
