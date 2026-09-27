BEGIN;

ALTER TABLE public.resume_education_entries
  ADD COLUMN IF NOT EXISTS education_category text;

ALTER TABLE public.resume_education_translations
  ADD COLUMN IF NOT EXISTS custom_category_label text;

DO $migration$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.resume_education_entries'::regclass
      AND conname = 'resume_education_entries_category_check'
  ) THEN
    ALTER TABLE public.resume_education_entries
      ADD CONSTRAINT resume_education_entries_category_check
      CHECK (
        education_category IS NULL
        OR education_category IN ('undergraduate', 'graduate', 'doctoral', 'summerSchool', 'custom')
      );
  END IF;
END
$migration$;

COMMIT;
