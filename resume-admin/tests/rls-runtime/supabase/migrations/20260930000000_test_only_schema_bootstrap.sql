-- TEST ONLY. Reconstructs the verified subset required by the local runtime
-- authorization tests. This file is not a production migration or full dump.
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

CREATE TABLE public.resume_sites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), site_key text NOT NULL UNIQUE,
  is_published boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (length(trim(site_key)) > 0)
);
CREATE TABLE public.cms_admins (user_id uuid PRIMARY KEY, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.resume_locale_content (
  resume_id uuid NOT NULL REFERENCES public.resume_sites(id) ON DELETE CASCADE,
  locale text NOT NULL CHECK (locale IN ('zh','en')),
  education_label text NOT NULL, experience_label text NOT NULL, project_heading text NOT NULL,
  skills_label text NOT NULL, honors_label text NOT NULL, contact_label text NOT NULL,
  availability text NOT NULL, portfolio_label text NOT NULL, portfolio_href text NOT NULL,
  kaggle_label text NOT NULL, updated_at_label text NOT NULL, linkedin_label text NOT NULL,
  linkedin_href text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (resume_id, locale)
);
CREATE TABLE public.resume_profile (
  resume_id uuid PRIMARY KEY REFERENCES public.resume_sites(id) ON DELETE CASCADE,
  graduation_value text NOT NULL, avatar_initials text NOT NULL, footer_name text NOT NULL,
  copyright text NOT NULL, photo_url text NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.resume_profile_translations (
  resume_id uuid NOT NULL, locale text NOT NULL CHECK (locale IN ('zh','en')),
  name text NOT NULL, nav_about_label text NOT NULL, email_action_label text NOT NULL,
  graduation_label text NOT NULL, avatar_label text NOT NULL, contact_focus_heading text NOT NULL,
  contact_status_heading text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (resume_id, locale), FOREIGN KEY (resume_id, locale) REFERENCES public.resume_locale_content(resume_id, locale) ON DELETE CASCADE
);
CREATE TABLE public.resume_public_links (
  resume_id uuid PRIMARY KEY REFERENCES public.resume_sites(id) ON DELETE CASCADE,
  email text NOT NULL, github text NOT NULL, github_label text NOT NULL, linkedin_display_name text NOT NULL,
  email_label text NOT NULL, linkedin_label text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.resume_navigation_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), resume_id uuid NOT NULL REFERENCES public.resume_sites(id) ON DELETE CASCADE,
  position integer NOT NULL CHECK (position >= 0), source_key text NULL,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id,resume_id), UNIQUE (resume_id,position)
);
CREATE UNIQUE INDEX resume_navigation_source_key_unique ON public.resume_navigation_items(resume_id,source_key) WHERE source_key IS NOT NULL;
CREATE TABLE public.resume_navigation_item_translations (
  navigation_item_id uuid NOT NULL, resume_id uuid NOT NULL, locale text NOT NULL CHECK (locale IN ('zh','en')),
  label text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (navigation_item_id,resume_id,locale),
  FOREIGN KEY (navigation_item_id,resume_id) REFERENCES public.resume_navigation_items(id,resume_id) ON DELETE CASCADE,
  FOREIGN KEY (resume_id,locale) REFERENCES public.resume_locale_content(resume_id,locale) ON DELETE CASCADE
);

CREATE TABLE public.resume_intro_paragraphs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), resume_id uuid NOT NULL REFERENCES public.resume_sites(id) ON DELETE CASCADE,
  position integer NOT NULL CHECK (position >= 0), source_key text NULL,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id,resume_id), UNIQUE (resume_id,position)
);
CREATE UNIQUE INDEX resume_intro_source_key_unique ON public.resume_intro_paragraphs(resume_id,source_key) WHERE source_key IS NOT NULL;
CREATE TABLE public.resume_intro_paragraph_translations (
  paragraph_id uuid NOT NULL, resume_id uuid NOT NULL, locale text NOT NULL CHECK (locale IN ('zh','en')),
  text text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (paragraph_id,locale),
  FOREIGN KEY (paragraph_id,resume_id) REFERENCES public.resume_intro_paragraphs(id,resume_id) ON DELETE CASCADE,
  FOREIGN KEY (resume_id,locale) REFERENCES public.resume_locale_content(resume_id,locale) ON DELETE CASCADE
);

CREATE TABLE public.resume_education_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), resume_id uuid NOT NULL REFERENCES public.resume_sites(id) ON DELETE CASCADE,
  source_key text NULL, position integer NOT NULL CHECK (position >= 0), entry_type text NOT NULL CHECK (entry_type IN ('standard','summerSchool')),
  education_category text NULL CHECK (education_category IS NULL OR education_category IN ('undergraduate','graduate','doctoral','summerSchool','custom')),
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id,resume_id), UNIQUE (resume_id,position), CHECK ((education_category = 'summerSchool') = (entry_type = 'summerSchool') OR education_category IS NULL)
);
CREATE UNIQUE INDEX resume_education_source_key_unique ON public.resume_education_entries(resume_id,source_key) WHERE source_key IS NOT NULL;
CREATE TABLE public.resume_education_translations (
  education_entry_id uuid NOT NULL, resume_id uuid NOT NULL, locale text NOT NULL CHECK (locale IN ('zh','en')),
  title text NOT NULL, program text NOT NULL, period text NOT NULL, grade text NOT NULL,
  course_title text NULL, course_description text NULL, custom_category_label text NULL,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (education_entry_id,locale),
  FOREIGN KEY (education_entry_id,resume_id) REFERENCES public.resume_education_entries(id,resume_id) ON DELETE CASCADE,
  FOREIGN KEY (resume_id,locale) REFERENCES public.resume_locale_content(resume_id,locale) ON DELETE CASCADE
);

CREATE TABLE public.resume_experience_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), resume_id uuid NOT NULL REFERENCES public.resume_sites(id) ON DELETE CASCADE,
  source_key text NULL, position integer NOT NULL CHECK (position >= 0), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id,resume_id), UNIQUE (resume_id,position)
);
CREATE UNIQUE INDEX resume_experience_source_key_unique ON public.resume_experience_entries(resume_id,source_key) WHERE source_key IS NOT NULL;
CREATE TABLE public.resume_experience_translations (
  experience_entry_id uuid NOT NULL, resume_id uuid NOT NULL, locale text NOT NULL CHECK (locale IN ('zh','en')),
  organization text NOT NULL, title text NOT NULL, period text NOT NULL, description text NOT NULL, location text NULL,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (experience_entry_id,locale),
  FOREIGN KEY (experience_entry_id,resume_id) REFERENCES public.resume_experience_entries(id,resume_id) ON DELETE CASCADE,
  FOREIGN KEY (resume_id,locale) REFERENCES public.resume_locale_content(resume_id,locale) ON DELETE CASCADE
);

CREATE TABLE public.resume_project_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), resume_id uuid NOT NULL REFERENCES public.resume_sites(id) ON DELETE CASCADE,
  source_key text NULL, position integer NOT NULL CHECK (position >= 0), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id,resume_id), UNIQUE (resume_id,position), UNIQUE (resume_id,source_key)
);
CREATE TABLE public.resume_project_translations (
  project_entry_id uuid NOT NULL, resume_id uuid NOT NULL, locale text NOT NULL CHECK (locale IN ('zh','en')),
  title text NOT NULL, subtitle text NOT NULL, period text NOT NULL, description text NOT NULL, href text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (project_entry_id,resume_id,locale),
  FOREIGN KEY (project_entry_id,resume_id) REFERENCES public.resume_project_entries(id,resume_id) ON DELETE CASCADE,
  FOREIGN KEY (resume_id,locale) REFERENCES public.resume_locale_content(resume_id,locale) ON DELETE CASCADE
);
CREATE TABLE public.resume_project_methods (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), resume_id uuid NOT NULL, project_entry_id uuid NOT NULL,
  locale text NOT NULL CHECK (locale IN ('zh','en')), position integer NOT NULL CHECK (position >= 0), value text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (project_entry_id,resume_id,locale) REFERENCES public.resume_project_translations(project_entry_id,resume_id,locale) ON DELETE CASCADE,
  UNIQUE (project_entry_id,resume_id,locale,position)
);

CREATE TABLE public.resume_skill_groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), resume_id uuid NOT NULL REFERENCES public.resume_sites(id) ON DELETE CASCADE,
  source_key text NULL, position integer NOT NULL CHECK (position >= 0), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id,resume_id), UNIQUE (resume_id,position)
);
CREATE UNIQUE INDEX resume_skill_source_key_unique ON public.resume_skill_groups(resume_id,source_key) WHERE source_key IS NOT NULL;
CREATE TABLE public.resume_skill_group_translations (
  skill_group_id uuid NOT NULL, resume_id uuid NOT NULL, locale text NOT NULL CHECK (locale IN ('zh','en')),
  title text NOT NULL, items text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (skill_group_id,locale),
  FOREIGN KEY (skill_group_id,resume_id) REFERENCES public.resume_skill_groups(id,resume_id) ON DELETE CASCADE,
  FOREIGN KEY (resume_id,locale) REFERENCES public.resume_locale_content(resume_id,locale) ON DELETE CASCADE
);
CREATE TABLE public.resume_award_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), resume_id uuid NOT NULL REFERENCES public.resume_sites(id) ON DELETE CASCADE,
  source_key text NULL, position integer NOT NULL CHECK (position >= 0), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id,resume_id), UNIQUE (resume_id,position), UNIQUE (resume_id,source_key)
);
CREATE TABLE public.resume_award_translations (
  award_entry_id uuid NOT NULL, resume_id uuid NOT NULL, locale text NOT NULL CHECK (locale IN ('zh','en')),
  name text NOT NULL, year text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (award_entry_id,locale),
  FOREIGN KEY (award_entry_id,resume_id) REFERENCES public.resume_award_entries(id,resume_id) ON DELETE CASCADE,
  FOREIGN KEY (resume_id,locale) REFERENCES public.resume_locale_content(resume_id,locale) ON DELETE CASCADE
);
CREATE INDEX resume_award_translations_resume_locale_idx ON public.resume_award_translations(resume_id,locale);

CREATE TABLE public.resume_contact_focus_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), resume_id uuid NOT NULL REFERENCES public.resume_sites(id) ON DELETE CASCADE,
  position integer NOT NULL CHECK (position >= 0), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id,resume_id), UNIQUE (resume_id,position)
);
CREATE TABLE public.resume_contact_focus_translations (
  focus_item_id uuid NOT NULL, resume_id uuid NOT NULL, locale text NOT NULL CHECK (locale IN ('zh','en')),
  title text NOT NULL, detail text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (focus_item_id,resume_id,locale),
  FOREIGN KEY (focus_item_id,resume_id) REFERENCES public.resume_contact_focus_items(id,resume_id) ON DELETE CASCADE,
  FOREIGN KEY (resume_id,locale) REFERENCES public.resume_locale_content(resume_id,locale) ON DELETE CASCADE
);
CREATE TABLE public.resume_contact_status_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), resume_id uuid NOT NULL REFERENCES public.resume_sites(id) ON DELETE CASCADE,
  position integer NOT NULL CHECK (position >= 0), status_type text NOT NULL CHECK (status_type IN ('study','graduation','open')),
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id,resume_id), UNIQUE (resume_id,position)
);
CREATE TABLE public.resume_contact_status_translations (
  status_item_id uuid NOT NULL, resume_id uuid NOT NULL, locale text NOT NULL CHECK (locale IN ('zh','en')),
  title text NOT NULL, detail text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (status_item_id,resume_id,locale),
  FOREIGN KEY (status_item_id,resume_id) REFERENCES public.resume_contact_status_items(id,resume_id) ON DELETE CASCADE,
  FOREIGN KEY (resume_id,locale) REFERENCES public.resume_locale_content(resume_id,locale) ON DELETE CASCADE
);

CREATE OR REPLACE FUNCTION public.is_resume_admin()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (SELECT 1 FROM public.cms_admins WHERE user_id = (SELECT auth.uid()));
$$;
CREATE OR REPLACE FUNCTION public.test_is_resume_published(target_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT COALESCE((SELECT is_published FROM public.resume_sites WHERE id = target_id), false);
$$;
CREATE OR REPLACE FUNCTION public.rls_test_assert(ok boolean, description text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF NOT COALESCE(ok, false) THEN RAISE EXCEPTION 'RLS TEST FAILED: %', description; END IF; END;
$$;
GRANT EXECUTE ON FUNCTION public.test_is_resume_published(uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rls_test_assert(boolean,text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.is_resume_admin() TO authenticated;

INSERT INTO public.resume_sites(id,site_key,is_published) VALUES
 ('20000000-0000-4000-8000-000000000001','example-cv',true),
 ('ea111111-1111-4111-8111-111111111111','example-cv-qa',false);
INSERT INTO public.cms_admins(user_id) VALUES ('10000000-0000-4000-8000-000000000001');
INSERT INTO public.resume_locale_content(resume_id,locale,education_label,experience_label,project_heading,skills_label,
  honors_label,contact_label,availability,portfolio_label,portfolio_href,kaggle_label,updated_at_label,linkedin_label,linkedin_href)
VALUES
 ('20000000-0000-4000-8000-000000000001','zh','Test education','Test experience','Test projects','Test skills','Test awards','Test contact','Synthetic','Test PDF','https://example.invalid/official-zh.pdf','Test project','Test updated','Test LinkedIn','https://example.invalid/official-link'),
 ('20000000-0000-4000-8000-000000000001','en','Test education','Test experience','Test projects','Test skills','Test awards','Test contact','Synthetic','Test PDF','https://example.invalid/official-en.pdf','Test project','Test updated','Test LinkedIn','https://example.invalid/official-link');
INSERT INTO public.resume_profile(resume_id,graduation_value,avatar_initials,footer_name,copyright,photo_url)
VALUES ('20000000-0000-4000-8000-000000000001','Synthetic','OF','Synthetic Owner Fixture','Synthetic copyright',NULL);
INSERT INTO public.resume_profile_translations(resume_id,locale,name,nav_about_label,email_action_label,graduation_label,avatar_label,contact_focus_heading,contact_status_heading)
VALUES
 ('20000000-0000-4000-8000-000000000001','zh','合成官方测试','关于','邮件','毕业','头像','方向','状态'),
 ('20000000-0000-4000-8000-000000000001','en','Synthetic Official Fixture','About','Email','Graduation','Avatar','Focus','Status');
INSERT INTO public.resume_intro_paragraphs(id,resume_id,position,source_key)
VALUES ('20000000-0000-4000-8000-000000000011','20000000-0000-4000-8000-000000000001',0,'test-official-intro');
INSERT INTO public.resume_intro_paragraph_translations(paragraph_id,resume_id,locale,text)
VALUES
 ('20000000-0000-4000-8000-000000000011','20000000-0000-4000-8000-000000000001','zh','合成测试文本'),
 ('20000000-0000-4000-8000-000000000011','20000000-0000-4000-8000-000000000001','en','Synthetic test text');

ALTER TABLE public.resume_sites ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cms_admins ENABLE ROW LEVEL SECURITY;
DO $enable_content_rls$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'resume_profile','resume_profile_translations','resume_public_links','resume_locale_content',
    'resume_intro_paragraphs','resume_intro_paragraph_translations','resume_navigation_items','resume_navigation_item_translations',
    'resume_education_entries','resume_education_translations','resume_experience_entries','resume_experience_translations',
    'resume_project_entries','resume_project_translations','resume_project_methods','resume_skill_groups','resume_skill_group_translations',
    'resume_award_entries','resume_award_translations','resume_contact_focus_items','resume_contact_focus_translations',
    'resume_contact_status_items','resume_contact_status_translations'
  ] LOOP EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t); END LOOP;
END $enable_content_rls$;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.resume_sites, public.cms_admins,
 public.resume_profile, public.resume_profile_translations, public.resume_public_links, public.resume_locale_content,
 public.resume_intro_paragraphs, public.resume_intro_paragraph_translations, public.resume_navigation_items, public.resume_navigation_item_translations,
 public.resume_education_entries, public.resume_education_translations, public.resume_experience_entries, public.resume_experience_translations,
 public.resume_project_entries, public.resume_project_translations, public.resume_project_methods, public.resume_skill_groups, public.resume_skill_group_translations,
 public.resume_award_entries, public.resume_award_translations, public.resume_contact_focus_items, public.resume_contact_focus_translations,
 public.resume_contact_status_items, public.resume_contact_status_translations TO anon, authenticated;

-- Synthetic legacy policy state: broad authenticated admin ALL policies and
-- distinct published SELECT policies, so migration replacement is exercised.
CREATE POLICY test_published_sites ON public.resume_sites FOR SELECT TO anon, authenticated USING (is_published);
CREATE POLICY test_admin_sites_all ON public.resume_sites FOR ALL TO authenticated USING (public.is_resume_admin()) WITH CHECK (public.is_resume_admin());
CREATE POLICY test_membership_self_read ON public.cms_admins FOR SELECT TO authenticated USING (user_id = (SELECT auth.uid()));
DO $legacy_cms_policies$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'resume_profile','resume_profile_translations','resume_public_links','resume_locale_content',
    'resume_intro_paragraphs','resume_intro_paragraph_translations','resume_navigation_items','resume_navigation_item_translations',
    'resume_education_entries','resume_education_translations','resume_experience_entries','resume_experience_translations',
    'resume_project_entries','resume_project_translations','resume_project_methods','resume_skill_groups','resume_skill_group_translations',
    'resume_award_entries','resume_award_translations','resume_contact_focus_items','resume_contact_focus_translations',
    'resume_contact_status_items','resume_contact_status_translations'
  ] LOOP
    EXECUTE format('CREATE POLICY test_published_select ON public.%I FOR SELECT TO anon, authenticated USING (public.test_is_resume_published(resume_id))', t);
    EXECUTE format('CREATE POLICY test_admin_all ON public.%I FOR ALL TO authenticated USING (public.is_resume_admin()) WITH CHECK (public.is_resume_admin())', t);
  END LOOP;
END $legacy_cms_policies$;

-- Local Supabase Storage is present; recreate only the legacy broad admin
-- policies for the two production bucket names used by the scoped migration.
INSERT INTO storage.buckets(id,name,public) VALUES ('profile-images','profile-images',true),('resume-files','resume-files',true);
GRANT SELECT, INSERT, UPDATE, DELETE ON storage.objects TO anon, authenticated;
CREATE POLICY test_legacy_admin_profile_images ON storage.objects FOR ALL TO authenticated
 USING (bucket_id='profile-images' AND public.is_resume_admin())
 WITH CHECK (bucket_id='profile-images' AND public.is_resume_admin());
CREATE POLICY test_legacy_admin_resume_files ON storage.objects FOR ALL TO authenticated
 USING (bucket_id='resume-files' AND public.is_resume_admin())
 WITH CHECK (bucket_id='resume-files' AND public.is_resume_admin());
