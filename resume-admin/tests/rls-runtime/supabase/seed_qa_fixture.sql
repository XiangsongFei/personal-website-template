-- TEST ONLY mirror of the repository QA fixture, with apply_reset enabled for this isolated local seed.
-- Generated synthetic rows only; synthetic membership is created separately after this file.
-- Never use this test seed with a remote Supabase project.
BEGIN;

DO $qa_fixture$
DECLARE
  qa_id CONSTANT uuid := 'ea111111-1111-4111-8111-111111111111';
  apply_reset CONSTANT boolean := true;
  official_count integer;
  official_id uuid;
  qa_key_count integer;
  qa_id_count integer;
  existing_qa_id uuid;
  existing_key text;
  existing_published boolean;
  table_name text;
  row_count bigint;
  content_tables CONSTANT text[] := ARRAY[
    'resume_profile', 'resume_profile_translations', 'resume_public_links',
    'resume_locale_content', 'resume_intro_paragraphs', 'resume_intro_paragraph_translations',
    'resume_navigation_items', 'resume_navigation_item_translations',
    'resume_education_entries', 'resume_education_translations',
    'resume_experience_entries', 'resume_experience_translations',
    'resume_project_entries', 'resume_project_translations', 'resume_project_methods',
    'resume_skill_groups', 'resume_skill_group_translations',
    'resume_award_entries', 'resume_award_translations',
    'resume_contact_focus_items', 'resume_contact_focus_translations',
    'resume_contact_status_items', 'resume_contact_status_translations'
  ];
BEGIN
  SELECT count(*) INTO official_count FROM public.resume_sites WHERE site_key = 'example-cv';
  IF official_count <> 1 THEN
    RAISE EXCEPTION 'Expected exactly one official root for site_key=example-cv; found %', official_count;
  END IF;
  SELECT id INTO official_id FROM public.resume_sites WHERE site_key = 'example-cv';
  IF qa_id = official_id THEN
    RAISE EXCEPTION 'Deterministic QA UUID must differ from the official resume ID';
  END IF;

  SELECT count(*) INTO qa_key_count FROM public.resume_sites WHERE site_key = 'example-cv-qa';
  IF qa_key_count > 1 THEN
    RAISE EXCEPTION 'Multiple QA roots use site_key=example-cv-qa';
  ELSIF qa_key_count = 1 THEN
    SELECT id, is_published INTO existing_qa_id, existing_published
    FROM public.resume_sites WHERE site_key = 'example-cv-qa';
    IF existing_qa_id <> qa_id THEN
      RAISE EXCEPTION 'QA site_key is already bound to a different resume ID';
    END IF;
    IF existing_published IS DISTINCT FROM false THEN
      RAISE EXCEPTION 'QA root must remain unpublished';
    END IF;
  END IF;

  SELECT count(*) INTO qa_id_count FROM public.resume_sites WHERE id = qa_id;
  IF qa_id_count = 1 THEN
    SELECT site_key INTO existing_key FROM public.resume_sites WHERE id = qa_id;
    IF existing_key IS DISTINCT FROM 'example-cv-qa' THEN
      RAISE EXCEPTION 'Deterministic QA UUID already belongs to another site';
    END IF;
  END IF;

  RAISE NOTICE 'Preflight passed. official_id differs from fixed QA UUID %.', qa_id;
  FOREACH table_name IN ARRAY content_tables LOOP
    EXECUTE pg_catalog.format('SELECT count(*) FROM public.%I WHERE resume_id = $1', table_name)
      INTO row_count USING qa_id;
    RAISE NOTICE 'Exact QA rows in public.%: %', table_name, row_count;
  END LOOP;

  IF NOT apply_reset THEN
    RAISE NOTICE 'Dry run only: no rows changed. Set apply_reset=true in this reviewed file to reset synthetic QA content.';
  ELSE
    IF qa_key_count = 0 AND qa_id_count = 0 THEN
      INSERT INTO public.resume_sites (id, site_key, is_published)
      VALUES (qa_id, 'example-cv-qa', false);
    ELSIF qa_key_count <> 1 OR qa_id_count <> 1
      OR existing_qa_id IS DISTINCT FROM qa_id
      OR existing_key IS DISTINCT FROM 'example-cv-qa'
      OR existing_published IS DISTINCT FROM false THEN
      RAISE EXCEPTION 'QA root changed after preflight; refusing reset';
    END IF;

    -- Every delete is restricted to the exact deterministic QA UUID.
    EXECUTE pg_catalog.format('DELETE FROM public.%I WHERE resume_id = $1', 'resume_project_methods') USING qa_id;
    EXECUTE pg_catalog.format('DELETE FROM public.%I WHERE resume_id = $1', 'resume_project_translations') USING qa_id;
    EXECUTE pg_catalog.format('DELETE FROM public.%I WHERE resume_id = $1', 'resume_intro_paragraph_translations') USING qa_id;
    EXECUTE pg_catalog.format('DELETE FROM public.%I WHERE resume_id = $1', 'resume_navigation_item_translations') USING qa_id;
    EXECUTE pg_catalog.format('DELETE FROM public.%I WHERE resume_id = $1', 'resume_education_translations') USING qa_id;
    EXECUTE pg_catalog.format('DELETE FROM public.%I WHERE resume_id = $1', 'resume_experience_translations') USING qa_id;
    EXECUTE pg_catalog.format('DELETE FROM public.%I WHERE resume_id = $1', 'resume_skill_group_translations') USING qa_id;
    EXECUTE pg_catalog.format('DELETE FROM public.%I WHERE resume_id = $1', 'resume_award_translations') USING qa_id;
    EXECUTE pg_catalog.format('DELETE FROM public.%I WHERE resume_id = $1', 'resume_contact_focus_translations') USING qa_id;
    EXECUTE pg_catalog.format('DELETE FROM public.%I WHERE resume_id = $1', 'resume_contact_status_translations') USING qa_id;
    EXECUTE pg_catalog.format('DELETE FROM public.%I WHERE resume_id = $1', 'resume_profile_translations') USING qa_id;
    EXECUTE pg_catalog.format('DELETE FROM public.%I WHERE resume_id = $1', 'resume_project_entries') USING qa_id;
    EXECUTE pg_catalog.format('DELETE FROM public.%I WHERE resume_id = $1', 'resume_intro_paragraphs') USING qa_id;
    EXECUTE pg_catalog.format('DELETE FROM public.%I WHERE resume_id = $1', 'resume_navigation_items') USING qa_id;
    EXECUTE pg_catalog.format('DELETE FROM public.%I WHERE resume_id = $1', 'resume_education_entries') USING qa_id;
    EXECUTE pg_catalog.format('DELETE FROM public.%I WHERE resume_id = $1', 'resume_experience_entries') USING qa_id;
    EXECUTE pg_catalog.format('DELETE FROM public.%I WHERE resume_id = $1', 'resume_skill_groups') USING qa_id;
    EXECUTE pg_catalog.format('DELETE FROM public.%I WHERE resume_id = $1', 'resume_award_entries') USING qa_id;
    EXECUTE pg_catalog.format('DELETE FROM public.%I WHERE resume_id = $1', 'resume_contact_focus_items') USING qa_id;
    EXECUTE pg_catalog.format('DELETE FROM public.%I WHERE resume_id = $1', 'resume_contact_status_items') USING qa_id;
    EXECUTE pg_catalog.format('DELETE FROM public.%I WHERE resume_id = $1', 'resume_profile') USING qa_id;
    EXECUTE pg_catalog.format('DELETE FROM public.%I WHERE resume_id = $1', 'resume_public_links') USING qa_id;
    EXECUTE pg_catalog.format('DELETE FROM public.%I WHERE resume_id = $1', 'resume_locale_content') USING qa_id;

    INSERT INTO public.resume_locale_content (resume_id, locale, education_label, experience_label, project_heading, skills_label, honors_label, contact_label, availability, portfolio_label, portfolio_href, kaggle_label, updated_at_label, linkedin_label, linkedin_href)
    VALUES
      (qa_id, 'zh', '教育（QA）', '经历（QA）', '项目（QA）', '技能（QA）', '奖项（QA）', '联系（QA）', 'QA 测试中', '中文简历（QA）', 'https://example.invalid/qa-resume-zh.pdf', '示例项目', '更新时间', '领英（QA）', 'https://example.invalid/qa-linkedin'),
      (qa_id, 'en', 'Education (QA)', 'Experience (QA)', 'Projects (QA)', 'Skills (QA)', 'Awards (QA)', 'Contact (QA)', 'QA fixture available', 'Resume (QA)', 'https://example.invalid/qa-resume-en.pdf', 'Sample project', 'Updated', 'LinkedIn (QA)', 'https://example.invalid/qa-linkedin');

    INSERT INTO public.resume_profile (resume_id, graduation_value, avatar_initials, footer_name, copyright, photo_url)
    VALUES
      (qa_id, 'QA fixture', 'QA', 'QA Example User', '© QA Example User', NULL);

    INSERT INTO public.resume_profile_translations (resume_id, locale, name, nav_about_label, email_action_label, graduation_label, avatar_label, contact_focus_heading, contact_status_heading)
    VALUES
      (qa_id, 'zh', 'QA 测试用户', '关于 QA', '发送测试邮件', '教育状态', 'QA 头像', '测试联系方向', '测试状态'),
      (qa_id, 'en', 'QA Example User', 'About QA', 'Send test email', 'Education status', 'QA avatar', 'QA contact focus', 'QA status');

    INSERT INTO public.resume_public_links (resume_id, email, github, github_label, linkedin_display_name, email_label, linkedin_label)
    VALUES
      (qa_id, 'qa@example.invalid', 'https://example.invalid/qa-github', 'QA 示例代码', 'QA 测试用户', '测试邮箱', '领英（QA）');

    INSERT INTO public.resume_navigation_items (id, resume_id, position, source_key)
    VALUES
      ('ea000000-0000-4000-8000-000000000001', qa_id, '0', 'qa-nav-1'),
      ('ea000000-0000-4000-8000-000000000002', qa_id, '1', 'qa-nav-2'),
      ('ea000000-0000-4000-8000-000000000003', qa_id, '2', 'qa-nav-3'),
      ('ea000000-0000-4000-8000-000000000004', qa_id, '3', 'qa-nav-4'),
      ('ea000000-0000-4000-8000-000000000005', qa_id, '4', 'qa-nav-5');

    INSERT INTO public.resume_navigation_item_translations (navigation_item_id, resume_id, locale, label)
    VALUES
      ('ea000000-0000-4000-8000-000000000001', qa_id, 'zh', '经历'),
      ('ea000000-0000-4000-8000-000000000001', qa_id, 'en', 'Experience'),
      ('ea000000-0000-4000-8000-000000000002', qa_id, 'zh', '项目'),
      ('ea000000-0000-4000-8000-000000000002', qa_id, 'en', 'Projects'),
      ('ea000000-0000-4000-8000-000000000003', qa_id, 'zh', '技能'),
      ('ea000000-0000-4000-8000-000000000003', qa_id, 'en', 'Skills'),
      ('ea000000-0000-4000-8000-000000000004', qa_id, 'zh', '奖项'),
      ('ea000000-0000-4000-8000-000000000004', qa_id, 'en', 'Awards'),
      ('ea000000-0000-4000-8000-000000000005', qa_id, 'zh', '联系'),
      ('ea000000-0000-4000-8000-000000000005', qa_id, 'en', 'Contact');

    INSERT INTO public.resume_intro_paragraphs (id, resume_id, position, source_key)
    VALUES
      ('ea000000-0000-4000-8000-000000000006', qa_id, '0', 'qa-intro-1'),
      ('ea000000-0000-4000-8000-000000000007', qa_id, '1', 'qa-intro-2');

    INSERT INTO public.resume_intro_paragraph_translations (paragraph_id, resume_id, locale, text)
    VALUES
      ('ea000000-0000-4000-8000-000000000006', qa_id, 'zh', '这是用于测试第 1 段介绍编辑与排序的合成内容。'),
      ('ea000000-0000-4000-8000-000000000006', qa_id, 'en', 'Synthetic introduction paragraph 1 for editing and reorder checks.'),
      ('ea000000-0000-4000-8000-000000000007', qa_id, 'zh', '这是用于测试第 2 段介绍编辑与排序的合成内容。'),
      ('ea000000-0000-4000-8000-000000000007', qa_id, 'en', 'Synthetic introduction paragraph 2 for editing and reorder checks.');

    INSERT INTO public.resume_education_entries (id, resume_id, source_key, position, entry_type, education_category)
    VALUES
      ('ea000000-0000-4000-8000-000000000008', qa_id, 'qa-education-undergrad', '0', 'standard', 'undergraduate'),
      ('ea000000-0000-4000-8000-000000000009', qa_id, 'qa-education-summer', '1', 'summerSchool', 'summerSchool');

    INSERT INTO public.resume_education_translations (education_entry_id, resume_id, locale, title, program, period, grade, course_title, course_description, custom_category_label)
    VALUES
      ('ea000000-0000-4000-8000-000000000008', qa_id, 'zh', 'QA 示例学院', '合成学士项目', 'QA 时间段', 'QA 成绩', NULL, NULL, NULL),
      ('ea000000-0000-4000-8000-000000000008', qa_id, 'en', 'QA Sample Institute', 'Synthetic undergraduate program', 'QA period', 'QA grade', NULL, NULL, NULL),
      ('ea000000-0000-4000-8000-000000000009', qa_id, 'zh', 'QA 夏季课程', '合成短期项目', 'QA 时间段', 'QA 成绩', NULL, NULL, NULL),
      ('ea000000-0000-4000-8000-000000000009', qa_id, 'en', 'QA Summer Session', 'Synthetic short program', 'QA period', 'QA grade', NULL, NULL, NULL);

    INSERT INTO public.resume_experience_entries (id, resume_id, source_key, position)
    VALUES
      ('ea000000-0000-4000-8000-000000000010', qa_id, 'qa-experience-1', '0'),
      ('ea000000-0000-4000-8000-000000000011', qa_id, 'qa-experience-2', '1');

    INSERT INTO public.resume_experience_translations (experience_entry_id, resume_id, locale, organization, title, period, description, location)
    VALUES
      ('ea000000-0000-4000-8000-000000000010', qa_id, 'zh', 'QA 合成组织 1', '测试角色', 'QA 时间段', '用于 CRUD 与排序验证的虚构描述。', 'QA 虚构地点'),
      ('ea000000-0000-4000-8000-000000000010', qa_id, 'en', 'QA Synthetic Org 1', 'Test role', 'QA period', 'Fictional description for CRUD and ordering checks.', 'QA sample location'),
      ('ea000000-0000-4000-8000-000000000011', qa_id, 'zh', 'QA 合成组织 2', '测试角色', 'QA 时间段', '用于 CRUD 与排序验证的虚构描述。', 'QA 虚构地点'),
      ('ea000000-0000-4000-8000-000000000011', qa_id, 'en', 'QA Synthetic Org 2', 'Test role', 'QA period', 'Fictional description for CRUD and ordering checks.', 'QA sample location');

    INSERT INTO public.resume_project_entries (id, resume_id, source_key, position)
    VALUES
      ('ea000000-0000-4000-8000-000000000012', qa_id, 'qa-project-main', '0');

    INSERT INTO public.resume_project_translations (project_entry_id, resume_id, locale, title, subtitle, period, description, href)
    VALUES
      ('ea000000-0000-4000-8000-000000000012', qa_id, 'zh', 'QA 示例项目', '合成项目副标题', 'QA 时间段', '用于测试项目与方法列表的虚构描述。', 'https://example.invalid/qa-project'),
      ('ea000000-0000-4000-8000-000000000012', qa_id, 'en', 'QA Sample Project', 'Synthetic project subtitle', 'QA period', 'Fictional description for project and methods testing.', 'https://example.invalid/qa-project');

    INSERT INTO public.resume_project_methods (id, resume_id, project_entry_id, locale, position, value)
    VALUES
      ('ea000000-0000-4000-8000-000000000013', qa_id, 'ea000000-0000-4000-8000-000000000012', 'zh', '0', 'QA 合成方法 1'),
      ('ea000000-0000-4000-8000-000000000014', qa_id, 'ea000000-0000-4000-8000-000000000012', 'zh', '1', 'QA 合成方法 2'),
      ('ea000000-0000-4000-8000-000000000015', qa_id, 'ea000000-0000-4000-8000-000000000012', 'en', '0', 'QA synthetic method 1'),
      ('ea000000-0000-4000-8000-000000000016', qa_id, 'ea000000-0000-4000-8000-000000000012', 'en', '1', 'QA synthetic method 2');

    INSERT INTO public.resume_skill_groups (id, resume_id, source_key, position)
    VALUES
      ('ea000000-0000-4000-8000-000000000017', qa_id, 'qa-skill-1', '0'),
      ('ea000000-0000-4000-8000-000000000018', qa_id, 'qa-skill-2', '1');

    INSERT INTO public.resume_skill_group_translations (skill_group_id, resume_id, locale, title, items)
    VALUES
      ('ea000000-0000-4000-8000-000000000017', qa_id, 'zh', 'QA 技能组 1', '虚构技能甲、虚构技能乙'),
      ('ea000000-0000-4000-8000-000000000017', qa_id, 'en', 'QA Skill Group 1', 'Synthetic skill A, Synthetic skill B'),
      ('ea000000-0000-4000-8000-000000000018', qa_id, 'zh', 'QA 技能组 2', '虚构技能甲、虚构技能乙'),
      ('ea000000-0000-4000-8000-000000000018', qa_id, 'en', 'QA Skill Group 2', 'Synthetic skill A, Synthetic skill B');

    INSERT INTO public.resume_award_entries (id, resume_id, source_key, position)
    VALUES
      ('ea000000-0000-4000-8000-000000000019', qa_id, 'qa-award-1', '0'),
      ('ea000000-0000-4000-8000-000000000020', qa_id, 'qa-award-2', '1');

    INSERT INTO public.resume_award_translations (award_entry_id, resume_id, locale, name, year)
    VALUES
      ('ea000000-0000-4000-8000-000000000019', qa_id, 'zh', 'QA 虚构奖项 1', '2099'),
      ('ea000000-0000-4000-8000-000000000019', qa_id, 'en', 'QA Synthetic Award 1', '2099'),
      ('ea000000-0000-4000-8000-000000000020', qa_id, 'zh', 'QA 虚构奖项 2', '2099'),
      ('ea000000-0000-4000-8000-000000000020', qa_id, 'en', 'QA Synthetic Award 2', '2099');

    INSERT INTO public.resume_contact_focus_items (id, resume_id, position)
    VALUES
      ('ea000000-0000-4000-8000-000000000021', qa_id, '0'),
      ('ea000000-0000-4000-8000-000000000022', qa_id, '1');

    INSERT INTO public.resume_contact_focus_translations (focus_item_id, resume_id, locale, title, detail)
    VALUES
      ('ea000000-0000-4000-8000-000000000021', qa_id, 'zh', 'QA 联系方向 1', '这是虚构的联系方向详情。'),
      ('ea000000-0000-4000-8000-000000000021', qa_id, 'en', 'QA Focus 1', 'Synthetic contact focus detail.'),
      ('ea000000-0000-4000-8000-000000000022', qa_id, 'zh', 'QA 联系方向 2', '这是虚构的联系方向详情。'),
      ('ea000000-0000-4000-8000-000000000022', qa_id, 'en', 'QA Focus 2', 'Synthetic contact focus detail.');

    INSERT INTO public.resume_contact_status_items (id, resume_id, position, status_type)
    VALUES
      ('ea000000-0000-4000-8000-000000000023', qa_id, '0', 'study'),
      ('ea000000-0000-4000-8000-000000000024', qa_id, '1', 'graduation'),
      ('ea000000-0000-4000-8000-000000000025', qa_id, '2', 'open');

    INSERT INTO public.resume_contact_status_translations (status_item_id, resume_id, locale, title, detail)
    VALUES
      ('ea000000-0000-4000-8000-000000000023', qa_id, 'zh', 'QA 状态 study', '虚构的测试状态详情。'),
      ('ea000000-0000-4000-8000-000000000023', qa_id, 'en', 'QA study status', 'Synthetic test status detail.'),
      ('ea000000-0000-4000-8000-000000000024', qa_id, 'zh', 'QA 状态 graduation', '虚构的测试状态详情。'),
      ('ea000000-0000-4000-8000-000000000024', qa_id, 'en', 'QA graduation status', 'Synthetic test status detail.'),
      ('ea000000-0000-4000-8000-000000000025', qa_id, 'zh', 'QA 状态 open', '虚构的测试状态详情。'),
      ('ea000000-0000-4000-8000-000000000025', qa_id, 'en', 'QA open status', 'Synthetic test status detail.');
  END IF;
END
$qa_fixture$;

COMMIT;
