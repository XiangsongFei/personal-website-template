-- Keep resume_sites.updated_at as the canonical last-modified timestamp for
-- every persisted resume-content mutation. This trigger is intentionally not
-- attached to resume_sites, so the parent update cannot recurse.
CREATE OR REPLACE FUNCTION public.touch_resume_site_updated_at_from_content()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE public.resume_sites AS parent_site
    SET updated_at = pg_catalog.now()
    WHERE parent_site.id = NEW.resume_id;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE public.resume_sites AS parent_site
    SET updated_at = pg_catalog.now()
    WHERE parent_site.id = OLD.resume_id;
    RETURN OLD;
  ELSE
    UPDATE public.resume_sites AS parent_site
    SET updated_at = pg_catalog.now()
    WHERE parent_site.id = NEW.resume_id;

    IF OLD.resume_id IS DISTINCT FROM NEW.resume_id THEN
      UPDATE public.resume_sites AS parent_site
      SET updated_at = pg_catalog.now()
      WHERE parent_site.id = OLD.resume_id;
    END IF;

    RETURN NEW;
  END IF;
END;
$function$;

DO $triggers$
DECLARE
  content_table text;
BEGIN
  FOREACH content_table IN ARRAY ARRAY[
    'resume_profile',
    'resume_profile_translations',
    'resume_locale_content',
    'resume_intro_paragraphs',
    'resume_intro_paragraph_translations',
    'resume_education_entries',
    'resume_education_translations',
    'resume_experience_entries',
    'resume_experience_translations',
    'resume_project_entries',
    'resume_project_translations',
    'resume_project_methods',
    'resume_skill_groups',
    'resume_skill_group_translations',
    'resume_award_entries',
    'resume_award_translations',
    'resume_contact_focus_items',
    'resume_contact_focus_translations',
    'resume_contact_status_items',
    'resume_contact_status_translations',
    'resume_navigation_items',
    'resume_navigation_item_translations',
    'resume_public_links'
  ] LOOP
    EXECUTE pg_catalog.format(
      'DROP TRIGGER IF EXISTS resume_sites_updated_at_rollup ON public.%I',
      content_table
    );
    EXECUTE pg_catalog.format(
      'CREATE TRIGGER resume_sites_updated_at_rollup AFTER INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.touch_resume_site_updated_at_from_content()',
      content_table
    );
  END LOOP;
END;
$triggers$;

-- Trigger creation above requires EXECUTE as the migration owner. Installed
-- triggers continue to invoke the function without granting direct access.
REVOKE EXECUTE
ON FUNCTION public.touch_resume_site_updated_at_from_content()
FROM PUBLIC;
