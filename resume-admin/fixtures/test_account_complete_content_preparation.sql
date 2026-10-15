-- PREPARATION ONLY: reviewed candidate for the approved Test account.
-- DO NOT EXECUTE without a separate explicit Production-write approval.
-- This is not a migration and is not in the Supabase CLI migration directory.
--
-- Baseline: e53ea7aa9071bb4047b8b31d29865d1876cc11c6 repository schema/model.
-- The repository's bootstrap is TEST ONLY, not a complete Production schema
-- dump. Confirm the live catalog matches all preconditions before any use.
--
-- Additive behavior: inserts only fixture rows that are absent; no UPDATE,
-- DELETE, capability, policy, storage, Activity Log, or Version History DML.
-- Content inserts may advance the Test resume_sites.updated_at timestamp via
-- existing triggers. Direct SQL inserts do not create normal Admin Activity Log
-- events and do not populate Version History. Owner and legacy QA content are
-- outside this fixture's write scope.
-- With the 17 destination tables empty, the first run inserts exactly 63 rows.
-- A repeat run skips matching fixture identities; it preserves any Test-edited
-- text and ordering. Unexpected uniqueness conflicts or wrong relationships
-- abort the transaction instead of being silently ignored.

BEGIN;
SET TRANSACTION ISOLATION LEVEL SERIALIZABLE;

DO $preflight$
DECLARE
  target constant uuid := 'f6000000-0000-4000-8000-000000000001';
  target_count integer;
  membership_count integer;
  locale_count integer;
  profile_count integer;
  profile_translation_count integer;
  links_count integer;
  nav_count integer;
  nav_translation_count integer;
  restore_enabled_count integer;
  missing_columns text;
BEGIN
  IF current_user <> 'postgres' THEN
    RAISE EXCEPTION 'Expected reviewed database administrator role postgres; got %', current_user;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' AND c.relname='resume_sites')
    OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' AND c.relname='cms_admins') THEN
    RAISE EXCEPTION 'Required target or membership table is missing';
  END IF;

  SELECT string_agg(required.table_name || '.' || required.column_name, ', ' ORDER BY required.table_name, required.column_name)
  INTO missing_columns
  FROM (VALUES
    ('resume_sites','id'),('resume_sites','site_key'),('resume_sites','is_published'),
    ('cms_admins','role'),('cms_admins','resume_id'),
    ('resume_locale_content','resume_id'),('resume_locale_content','locale'),
    ('resume_profile','resume_id'),('resume_profile_translations','resume_id'),('resume_profile_translations','locale'),
    ('resume_public_links','resume_id'),
    ('resume_navigation_items','id'),('resume_navigation_items','resume_id'),('resume_navigation_items','position'),('resume_navigation_items','source_key'),
    ('resume_navigation_item_translations','navigation_item_id'),('resume_navigation_item_translations','resume_id'),('resume_navigation_item_translations','locale'),('resume_navigation_item_translations','label'),
    ('resume_intro_paragraphs','id'),('resume_intro_paragraphs','resume_id'),('resume_intro_paragraphs','position'),('resume_intro_paragraphs','source_key'),
    ('resume_intro_paragraph_translations','paragraph_id'),('resume_intro_paragraph_translations','resume_id'),('resume_intro_paragraph_translations','locale'),('resume_intro_paragraph_translations','text'),
    ('resume_education_entries','id'),('resume_education_entries','resume_id'),('resume_education_entries','position'),('resume_education_entries','source_key'),('resume_education_entries','entry_type'),('resume_education_entries','education_category'),
    ('resume_education_translations','education_entry_id'),('resume_education_translations','resume_id'),('resume_education_translations','locale'),('resume_education_translations','title'),('resume_education_translations','program'),('resume_education_translations','period'),('resume_education_translations','grade'),('resume_education_translations','course_title'),('resume_education_translations','course_description'),('resume_education_translations','custom_category_label'),
    ('resume_experience_entries','id'),('resume_experience_entries','resume_id'),('resume_experience_entries','position'),('resume_experience_entries','source_key'),
    ('resume_experience_translations','experience_entry_id'),('resume_experience_translations','resume_id'),('resume_experience_translations','locale'),('resume_experience_translations','organization'),('resume_experience_translations','title'),('resume_experience_translations','period'),('resume_experience_translations','description'),('resume_experience_translations','location'),
    ('resume_project_entries','id'),('resume_project_entries','resume_id'),('resume_project_entries','position'),('resume_project_entries','source_key'),
    ('resume_project_translations','project_entry_id'),('resume_project_translations','resume_id'),('resume_project_translations','locale'),('resume_project_translations','title'),('resume_project_translations','subtitle'),('resume_project_translations','period'),('resume_project_translations','description'),('resume_project_translations','href'),
    ('resume_project_methods','id'),('resume_project_methods','project_entry_id'),('resume_project_methods','resume_id'),('resume_project_methods','locale'),('resume_project_methods','position'),('resume_project_methods','value'),
    ('resume_skill_groups','id'),('resume_skill_groups','resume_id'),('resume_skill_groups','position'),('resume_skill_groups','source_key'),
    ('resume_skill_group_translations','skill_group_id'),('resume_skill_group_translations','resume_id'),('resume_skill_group_translations','locale'),('resume_skill_group_translations','title'),('resume_skill_group_translations','items'),
    ('resume_award_entries','id'),('resume_award_entries','resume_id'),('resume_award_entries','position'),('resume_award_entries','source_key'),
    ('resume_award_translations','award_entry_id'),('resume_award_translations','resume_id'),('resume_award_translations','locale'),('resume_award_translations','name'),('resume_award_translations','year'),
    ('resume_contact_focus_items','id'),('resume_contact_focus_items','resume_id'),('resume_contact_focus_items','position'),
    ('resume_contact_focus_translations','focus_item_id'),('resume_contact_focus_translations','resume_id'),('resume_contact_focus_translations','locale'),('resume_contact_focus_translations','title'),('resume_contact_focus_translations','detail'),
    ('resume_contact_status_items','id'),('resume_contact_status_items','resume_id'),('resume_contact_status_items','position'),('resume_contact_status_items','status_type'),
    ('resume_contact_status_translations','status_item_id'),('resume_contact_status_translations','resume_id'),('resume_contact_status_translations','locale'),('resume_contact_status_translations','title'),('resume_contact_status_translations','detail'),
    ('resume_capabilities','resume_id'),('resume_capabilities','capability_key'),('resume_capabilities','enabled')
  ) AS required(table_name,column_name)
  WHERE NOT EXISTS (
    SELECT 1 FROM information_schema.columns c
    WHERE c.table_schema = CASE WHEN required.table_name='resume_capabilities' THEN 'cms_private' ELSE 'public' END
      AND c.table_name=required.table_name AND c.column_name=required.column_name
  );
  IF missing_columns IS NOT NULL THEN
    RAISE EXCEPTION 'Schema differs from reviewed fixture assumptions; missing columns: %', missing_columns;
  END IF;

  SELECT count(*) INTO target_count FROM public.resume_sites
  WHERE id=target AND site_key='example-cv-qa-activity-log' AND is_published=false;
  IF target_count <> 1 OR EXISTS (
      SELECT 1 FROM public.resume_sites
      WHERE (id=target AND site_key<>'example-cv-qa-activity-log')
         OR (site_key='example-cv-qa-activity-log' AND id<>target)
         OR (id=target AND is_published IS DISTINCT FROM false)
    ) THEN
    RAISE EXCEPTION 'Approved Test target identity or unpublished state does not match';
  END IF;

  SELECT count(*) INTO membership_count FROM public.cms_admins
  WHERE role='qa' AND resume_id=target;
  IF membership_count <> 1 THEN
    RAISE EXCEPTION 'Expected exactly one QA membership bound to the approved Test target; found %', membership_count;
  END IF;

  SELECT count(*) INTO locale_count FROM public.resume_locale_content WHERE resume_id=target;
  IF locale_count <> 2 OR EXISTS (
    SELECT 1 FROM public.resume_locale_content WHERE resume_id=target AND locale NOT IN ('zh','en')
  ) OR (SELECT count(*) FROM public.resume_locale_content WHERE resume_id=target AND locale IN ('zh','en')) <> 2 THEN
    RAISE EXCEPTION 'Expected exactly the zh/en locale rows for the Test target';
  END IF;

  SELECT count(*) INTO profile_count FROM public.resume_profile WHERE resume_id=target;
  SELECT count(*) INTO profile_translation_count FROM public.resume_profile_translations WHERE resume_id=target;
  SELECT count(*) INTO links_count FROM public.resume_public_links WHERE resume_id=target;
  IF profile_count <> 1 OR profile_translation_count <> 2 OR links_count <> 1 THEN
    RAISE EXCEPTION 'Existing synthetic Profile, bilingual Profile, or Links data is incomplete; refusing to invent or overwrite singleton data';
  END IF;

  SELECT count(*) INTO nav_count FROM public.resume_navigation_items WHERE resume_id=target;
  SELECT count(*) INTO nav_translation_count FROM public.resume_navigation_item_translations WHERE resume_id=target;
  IF nav_count <> 5 OR nav_translation_count <> 10 OR EXISTS (
    SELECT 1 FROM (VALUES
      (0,'qa-nav-1','经历','Experience'),(1,'qa-nav-2','项目','Projects'),
      (2,'qa-nav-3','技能','Skills'),(3,'qa-nav-4','奖项','Awards'),(4,'qa-nav-5','联系','Contact')
    ) expected(position,source_key,zh_label,en_label)
    LEFT JOIN public.resume_navigation_items n ON n.resume_id=target AND n.position=expected.position AND n.source_key=expected.source_key
    LEFT JOIN public.resume_navigation_item_translations zh ON zh.navigation_item_id=n.id AND zh.resume_id=target AND zh.locale='zh'
    LEFT JOIN public.resume_navigation_item_translations en ON en.navigation_item_id=n.id AND en.resume_id=target AND en.locale='en'
    WHERE n.id IS NULL OR zh.label IS DISTINCT FROM expected.zh_label OR en.label IS DISTINCT FROM expected.en_label
  ) THEN
    RAISE EXCEPTION 'Navigation is not exactly the reviewed five bilingual Test entries';
  END IF;

  IF EXISTS (
    SELECT 1 FROM cms_private.resume_capabilities
    WHERE resume_id=target AND capability_key='restore' AND enabled=true
  ) THEN
    RAISE EXCEPTION 'Restore is enabled for the Test target; stop and obtain separate review';
  END IF;

  -- A reserved ID is safe to reuse only with its exact fixture relationship.
  -- Text and positions may have been edited by the Test account and are not
  -- overwritten. A missing bilingual translation is inserted later.
  IF EXISTS (
    SELECT 1 FROM (VALUES
      ('f6000000-0000-4000-8000-000000000101'::uuid),
      ('f6000000-0000-4000-8000-000000000102'::uuid)
    ) AS expected(id)
    JOIN public.resume_contact_focus_items item ON item.id=expected.id
    WHERE item.resume_id IS DISTINCT FROM target
  ) OR EXISTS (
    SELECT 1 FROM (VALUES
      ('f6000000-0000-4000-8000-000000000111'::uuid,'study'),
      ('f6000000-0000-4000-8000-000000000112'::uuid,'graduation'),
      ('f6000000-0000-4000-8000-000000000113'::uuid,'open')
    ) AS expected(id,status_type)
    JOIN public.resume_contact_status_items item ON item.id=expected.id
    WHERE item.resume_id IS DISTINCT FROM target
       OR item.status_type IS DISTINCT FROM expected.status_type
  ) OR EXISTS (
    SELECT 1 FROM (VALUES
      ('f6000000-0000-4000-8000-000000000121'::uuid,'test-preview-v1-project-1','zh'),
      ('f6000000-0000-4000-8000-000000000122'::uuid,'test-preview-v1-project-1','zh'),
      ('f6000000-0000-4000-8000-000000000123'::uuid,'test-preview-v1-project-1','en'),
      ('f6000000-0000-4000-8000-000000000124'::uuid,'test-preview-v1-project-1','en'),
      ('f6000000-0000-4000-8000-000000000125'::uuid,'test-preview-v1-project-2','zh'),
      ('f6000000-0000-4000-8000-000000000126'::uuid,'test-preview-v1-project-2','en')
    ) AS expected(id,source_key,locale)
    JOIN public.resume_project_methods method ON method.id=expected.id
    LEFT JOIN public.resume_project_entries project ON project.id=method.project_entry_id
    WHERE method.resume_id IS DISTINCT FROM target
       OR method.locale IS DISTINCT FROM expected.locale
       OR project.resume_id IS DISTINCT FROM target
       OR project.source_key IS DISTINCT FROM expected.source_key
  ) OR EXISTS (
    SELECT 1 FROM public.resume_contact_focus_translations t
    WHERE t.focus_item_id IN ('f6000000-0000-4000-8000-000000000101','f6000000-0000-4000-8000-000000000102')
      AND (t.resume_id IS DISTINCT FROM target OR t.locale NOT IN ('zh','en'))
  ) OR EXISTS (
    SELECT 1 FROM public.resume_contact_status_translations t
    WHERE t.status_item_id IN ('f6000000-0000-4000-8000-000000000111','f6000000-0000-4000-8000-000000000112','f6000000-0000-4000-8000-000000000113')
      AND (t.resume_id IS DISTINCT FROM target OR t.locale NOT IN ('zh','en'))
  ) THEN
    RAISE EXCEPTION 'An existing fixed fixture ID has the wrong Test owner, parent, locale, or role';
  END IF;

  -- Serializes cooperating fixture runs and protects the target binding while
  -- this transaction prepares appends.
  PERFORM 1 FROM public.resume_sites WHERE id=target FOR UPDATE;
END
$preflight$;

-- Existing Profile, Profile translations, locale text, Links and Navigation
-- are validated above and intentionally left untouched.

-- Introduction: 3 bilingual paragraphs, with short, medium and long copy.
WITH desired(source_key,ordinal) AS (VALUES
 ('test-preview-v1-intro-1',1),('test-preview-v1-intro-2',2),('test-preview-v1-intro-3',3)
), missing AS (
 SELECT d.* FROM desired d WHERE NOT EXISTS (SELECT 1 FROM public.resume_intro_paragraphs p WHERE p.resume_id='f6000000-0000-4000-8000-000000000001' AND p.source_key=d.source_key)
), base AS (SELECT COALESCE(max(position),-1) AS position FROM public.resume_intro_paragraphs WHERE resume_id='f6000000-0000-4000-8000-000000000001')
INSERT INTO public.resume_intro_paragraphs(resume_id,source_key,position)
SELECT 'f6000000-0000-4000-8000-000000000001',m.source_key,b.position+row_number() OVER(ORDER BY m.ordinal)
FROM missing m CROSS JOIN base b;

INSERT INTO public.resume_intro_paragraph_translations(paragraph_id,resume_id,locale,text)
SELECT p.id,p.resume_id,v.locale,v.text FROM public.resume_intro_paragraphs p JOIN (VALUES
 ('test-preview-v1-intro-1','zh','你好，我是虚构的产品设计师林知夏。'),('test-preview-v1-intro-1','en','Hello, I am Lin Xia, a fictional product designer.'),
 ('test-preview-v1-intro-2','zh','我喜欢把复杂问题拆解成清晰、可访问且有温度的数字体验。这个较长段落用于检查双语排版、自动换行和预览滚动。'),('test-preview-v1-intro-2','en','I turn complex problems into clear, accessible, and thoughtful digital experiences. This longer paragraph checks bilingual typography, wrapping, and preview scrolling.'),
 ('test-preview-v1-intro-3','zh','在虚构的跨职能团队中，我通过研究、原型和迭代交付产品；也乐于记录取舍、分享方法，并持续从真实使用反馈中学习。'),('test-preview-v1-intro-3','en','In fictional cross-functional teams, I use research, prototyping, and iteration to ship useful products. I document trade-offs, share methods, and keep learning from real-world feedback.')
) AS v(source_key,locale,text) ON v.source_key=p.source_key
WHERE p.resume_id='f6000000-0000-4000-8000-000000000001'
  AND NOT EXISTS (SELECT 1 FROM public.resume_intro_paragraph_translations t
    WHERE t.paragraph_id=p.id AND t.resume_id=p.resume_id AND t.locale=v.locale);

-- Education: one standard undergraduate record and one summer-school record;
-- the latter exercises optional course text.
WITH desired(source_key,ordinal,entry_type,education_category) AS (VALUES
 ('test-preview-v1-education-1',1,'standard','undergraduate'),('test-preview-v1-education-2',2,'summerSchool','summerSchool')
), missing AS (
 SELECT d.* FROM desired d WHERE NOT EXISTS (SELECT 1 FROM public.resume_education_entries p WHERE p.resume_id='f6000000-0000-4000-8000-000000000001' AND p.source_key=d.source_key)
), base AS (SELECT COALESCE(max(position),-1) AS position FROM public.resume_education_entries WHERE resume_id='f6000000-0000-4000-8000-000000000001')
INSERT INTO public.resume_education_entries(resume_id,source_key,position,entry_type,education_category)
SELECT 'f6000000-0000-4000-8000-000000000001',m.source_key,b.position+row_number() OVER(ORDER BY m.ordinal),m.entry_type,m.education_category
FROM missing m CROSS JOIN base b;
INSERT INTO public.resume_education_translations(education_entry_id,resume_id,locale,title,program,period,grade,course_title,course_description,custom_category_label)
SELECT p.id,p.resume_id,v.locale,v.title,v.program,v.period,v.grade,v.course_title,v.course_description,NULL
FROM public.resume_education_entries p JOIN (VALUES
 ('test-preview-v1-education-1','zh','海岚大学','交互设计学士','2018—2022','优秀毕业设计',NULL,NULL),('test-preview-v1-education-1','en','Hailan University','B.A. in Interaction Design','2018–2022','Capstone with distinction',NULL,NULL),
 ('test-preview-v1-education-2','zh','北岸设计学院','服务设计暑期课程','2021 夏季','完成 6 周课程','公共服务体验','研究访谈、服务蓝图与原型实践'),('test-preview-v1-education-2','en','Northshore School of Design','Summer Programme in Service Design','Summer 2021','Completed six-week programme','Public service experiences','Interview research, service blueprints, and prototyping')
) AS v(source_key,locale,title,program,period,grade,course_title,course_description) ON v.source_key=p.source_key
WHERE p.resume_id='f6000000-0000-4000-8000-000000000001'
  AND NOT EXISTS (SELECT 1 FROM public.resume_education_translations t
    WHERE t.education_entry_id=p.id AND t.resume_id=p.resume_id AND t.locale=v.locale);

-- Work Experience: two entirely fictional organizations and roles.
WITH desired(source_key,ordinal) AS (VALUES ('test-preview-v1-experience-1',1),('test-preview-v1-experience-2',2)),
missing AS (SELECT d.* FROM desired d WHERE NOT EXISTS (SELECT 1 FROM public.resume_experience_entries p WHERE p.resume_id='f6000000-0000-4000-8000-000000000001' AND p.source_key=d.source_key)),
base AS (SELECT COALESCE(max(position),-1) AS position FROM public.resume_experience_entries WHERE resume_id='f6000000-0000-4000-8000-000000000001')
INSERT INTO public.resume_experience_entries(resume_id,source_key,position)
SELECT 'f6000000-0000-4000-8000-000000000001',m.source_key,b.position+row_number() OVER(ORDER BY m.ordinal) FROM missing m CROSS JOIN base b;
INSERT INTO public.resume_experience_translations(experience_entry_id,resume_id,locale,organization,title,period,description,location)
SELECT p.id,p.resume_id,v.locale,v.organization,v.title,v.period,v.description,v.location FROM public.resume_experience_entries p JOIN (VALUES
 ('test-preview-v1-experience-1','zh','纸飞机实验室（虚构）','产品设计实习生','2022.06—2022.12','与 4 人团队梳理新用户流程，基于 12 次合成访谈制作原型，并通过可用性走查减少关键任务中的重复步骤。','上海（虚构）'),('test-preview-v1-experience-1','en','Paperplane Lab (fictional)','Product Design Intern','Jun 2022–Dec 2022','Mapped onboarding with a four-person team, prototyped findings from twelve synthetic interviews, and reduced repeated steps in key tasks through usability reviews.','Shanghai (fictional)'),
 ('test-preview-v1-experience-2','zh','开放街区计划（虚构）','志愿者研究协作者','2021.03—2021.11','协助社区团队整理反馈、绘制服务蓝图，并把研究结论转成可执行的无障碍改进清单。','远程 / 虚构'),('test-preview-v1-experience-2','en','Open Blocks Initiative (fictional)','Volunteer Research Collaborator','Mar 2021–Nov 2021','Helped a community team synthesize feedback, map a service blueprint, and turn research findings into an actionable accessibility checklist.','Remote / fictional')
) AS v(source_key,locale,organization,title,period,description,location) ON v.source_key=p.source_key WHERE p.resume_id='f6000000-0000-4000-8000-000000000001'
  AND NOT EXISTS (SELECT 1 FROM public.resume_experience_translations t
    WHERE t.experience_entry_id=p.id AND t.resume_id=p.resume_id AND t.locale=v.locale);

-- Projects: two fictional examples; the second has no external URL. Six method
-- rows exercise ordered bilingual lists and wrapped text.
WITH desired(source_key,ordinal) AS (VALUES ('test-preview-v1-project-1',1),('test-preview-v1-project-2',2)),
missing AS (SELECT d.* FROM desired d WHERE NOT EXISTS (SELECT 1 FROM public.resume_project_entries p WHERE p.resume_id='f6000000-0000-4000-8000-000000000001' AND p.source_key=d.source_key)),
base AS (SELECT COALESCE(max(position),-1) AS position FROM public.resume_project_entries WHERE resume_id='f6000000-0000-4000-8000-000000000001')
INSERT INTO public.resume_project_entries(resume_id,source_key,position)
SELECT 'f6000000-0000-4000-8000-000000000001',m.source_key,b.position+row_number() OVER(ORDER BY m.ordinal) FROM missing m CROSS JOIN base b;
INSERT INTO public.resume_project_translations(project_entry_id,resume_id,locale,title,subtitle,period,description,href)
SELECT p.id,p.resume_id,v.locale,v.title,v.subtitle,v.period,v.description,v.href FROM public.resume_project_entries p JOIN (VALUES
 ('test-preview-v1-project-1','zh','慢速地图','面向步行者的无障碍路线概念','2023','一个虚构的地图概念，突出路线坡度、休息点与路面信息。长描述用于测试卡片内容密度和响应式高度。','https://example.invalid/synthetic-map'),('test-preview-v1-project-1','en','Slow Map','An accessible-route concept for pedestrians','2023','A fictional map concept highlighting route gradients, rest stops, and surface notes. The longer description checks card density and responsive height.','https://example.invalid/synthetic-map'),
 ('test-preview-v1-project-2','zh','邻里交换站','社区物品共享服务原型','2022','为虚构社区设计的轻量物品共享流程，重点验证空状态、信任提示与清晰的归还时间。',''),('test-preview-v1-project-2','en','Neighbourhood Exchange','A prototype for sharing useful items locally','2022','A lightweight sharing flow for a fictional neighbourhood, focused on empty states, trust cues, and clear return times.','')
) AS v(source_key,locale,title,subtitle,period,description,href) ON v.source_key=p.source_key WHERE p.resume_id='f6000000-0000-4000-8000-000000000001'
  AND NOT EXISTS (SELECT 1 FROM public.resume_project_translations t
    WHERE t.project_entry_id=p.id AND t.resume_id=p.resume_id AND t.locale=v.locale);
WITH desired(id,source_key,locale,ordinal,value) AS (VALUES
 ('f6000000-0000-4000-8000-000000000121'::uuid,'test-preview-v1-project-1','zh',1,'路线访谈与无障碍审核'),('f6000000-0000-4000-8000-000000000122','test-preview-v1-project-1','zh',2,'信息架构、低保真原型与走查'),('f6000000-0000-4000-8000-000000000123','test-preview-v1-project-1','en',1,'Route interviews and accessibility review'),('f6000000-0000-4000-8000-000000000124','test-preview-v1-project-1','en',2,'Information architecture, wireframes, and walkthroughs'),('f6000000-0000-4000-8000-000000000125','test-preview-v1-project-2','zh',1,'服务蓝图与社区共创'),('f6000000-0000-4000-8000-000000000126','test-preview-v1-project-2','en',1,'Service blueprint and community co-design')
), joined AS (
 SELECT d.*,p.id AS project_id,p.resume_id FROM desired d JOIN public.resume_project_entries p ON p.resume_id='f6000000-0000-4000-8000-000000000001' AND p.source_key=d.source_key
), missing AS (SELECT j.* FROM joined j WHERE NOT EXISTS (SELECT 1 FROM public.resume_project_methods m WHERE m.id=j.id)),
positions AS (SELECT m.*,COALESCE((SELECT max(pm.position) FROM public.resume_project_methods pm WHERE pm.project_entry_id=m.project_id AND pm.resume_id=m.resume_id AND pm.locale=m.locale),-1) AS base_position FROM missing m)
INSERT INTO public.resume_project_methods(id,resume_id,project_entry_id,locale,position,value)
SELECT id,resume_id,project_id,locale,base_position+row_number() OVER(PARTITION BY project_id,locale ORDER BY ordinal),value FROM positions;

-- Skills: three groups with short and longer comma-delimited item lists.
WITH desired(source_key,ordinal) AS (VALUES ('test-preview-v1-skill-1',1),('test-preview-v1-skill-2',2),('test-preview-v1-skill-3',3)),
missing AS (SELECT d.* FROM desired d WHERE NOT EXISTS (SELECT 1 FROM public.resume_skill_groups p WHERE p.resume_id='f6000000-0000-4000-8000-000000000001' AND p.source_key=d.source_key)),
base AS (SELECT COALESCE(max(position),-1) AS position FROM public.resume_skill_groups WHERE resume_id='f6000000-0000-4000-8000-000000000001')
INSERT INTO public.resume_skill_groups(resume_id,source_key,position)
SELECT 'f6000000-0000-4000-8000-000000000001',m.source_key,b.position+row_number() OVER(ORDER BY m.ordinal) FROM missing m CROSS JOIN base b;
INSERT INTO public.resume_skill_group_translations(skill_group_id,resume_id,locale,title,items)
SELECT p.id,p.resume_id,v.locale,v.title,v.items FROM public.resume_skill_groups p JOIN (VALUES
 ('test-preview-v1-skill-1','zh','研究与策略','用户访谈、问题定义、竞品分析'),('test-preview-v1-skill-1','en','Research & Strategy','User interviews, problem framing, competitive analysis'),
 ('test-preview-v1-skill-2','zh','交互与原型','信息架构、流程图、Figma 原型、可用性测试、无障碍审核'),('test-preview-v1-skill-2','en','Interaction & Prototyping','Information architecture, user flows, Figma prototyping, usability testing, accessibility reviews'),
 ('test-preview-v1-skill-3','zh','协作与交付','设计系统、文档写作、跨职能协作'),('test-preview-v1-skill-3','en','Collaboration & Delivery','Design systems, documentation, cross-functional collaboration')
) AS v(source_key,locale,title,items) ON v.source_key=p.source_key WHERE p.resume_id='f6000000-0000-4000-8000-000000000001'
  AND NOT EXISTS (SELECT 1 FROM public.resume_skill_group_translations t
    WHERE t.skill_group_id=p.id AND t.resume_id=p.resume_id AND t.locale=v.locale);

-- Awards: fictional recognition and a short optional description encoded in name.
WITH desired(source_key,ordinal) AS (VALUES ('test-preview-v1-award-1',1),('test-preview-v1-award-2',2)),
missing AS (SELECT d.* FROM desired d WHERE NOT EXISTS (SELECT 1 FROM public.resume_award_entries p WHERE p.resume_id='f6000000-0000-4000-8000-000000000001' AND p.source_key=d.source_key)),
base AS (SELECT COALESCE(max(position),-1) AS position FROM public.resume_award_entries WHERE resume_id='f6000000-0000-4000-8000-000000000001')
INSERT INTO public.resume_award_entries(resume_id,source_key,position)
SELECT 'f6000000-0000-4000-8000-000000000001',m.source_key,b.position+row_number() OVER(ORDER BY m.ordinal) FROM missing m CROSS JOIN base b;
INSERT INTO public.resume_award_translations(award_entry_id,resume_id,locale,name,year)
SELECT p.id,p.resume_id,v.locale,v.name,v.year FROM public.resume_award_entries p JOIN (VALUES
 ('test-preview-v1-award-1','zh','虚构服务设计挑战赛 · 优胜提案','2023'),('test-preview-v1-award-1','en','Fictional Service Design Challenge · Selected Proposal','2023'),
 ('test-preview-v1-award-2','zh','校园创意周 · 观众选择奖','2021'),('test-preview-v1-award-2','en','Campus Creative Week · Audience Choice','2021')
) AS v(source_key,locale,name,year) ON v.source_key=p.source_key WHERE p.resume_id='f6000000-0000-4000-8000-000000000001'
  AND NOT EXISTS (SELECT 1 FROM public.resume_award_translations t
    WHERE t.award_entry_id=p.id AND t.resume_id=p.resume_id AND t.locale=v.locale);

-- Contact focus/status: fixed IDs make rows repeat-safe because these tables do
-- not expose source_key columns. Position appends after existing user rows.
WITH desired(id,ordinal) AS (VALUES ('f6000000-0000-4000-8000-000000000101'::uuid,1),('f6000000-0000-4000-8000-000000000102',2)),
missing AS (SELECT d.* FROM desired d WHERE NOT EXISTS (SELECT 1 FROM public.resume_contact_focus_items p WHERE p.id=d.id AND p.resume_id='f6000000-0000-4000-8000-000000000001')),
base AS (SELECT COALESCE(max(position),-1) AS position FROM public.resume_contact_focus_items WHERE resume_id='f6000000-0000-4000-8000-000000000001')
INSERT INTO public.resume_contact_focus_items(id,resume_id,position)
SELECT m.id,'f6000000-0000-4000-8000-000000000001',b.position+row_number() OVER(ORDER BY m.ordinal) FROM missing m CROSS JOIN base b;
INSERT INTO public.resume_contact_focus_translations(focus_item_id,resume_id,locale,title,detail)
SELECT p.id,p.resume_id,v.locale,v.title,v.detail FROM public.resume_contact_focus_items p JOIN (VALUES
 ('f6000000-0000-4000-8000-000000000101'::uuid,'zh','关注方向','让公共服务更易理解与使用'),('f6000000-0000-4000-8000-000000000101','en','Current focus','Making public services easier to understand and use'),
 ('f6000000-0000-4000-8000-000000000102','zh','正在探索','以小步原型验证复杂流程中的关键决策点。'),('f6000000-0000-4000-8000-000000000102','en','Exploring','Using small prototypes to test key decisions in complex flows.')
) AS v(id,locale,title,detail) ON v.id=p.id WHERE p.resume_id='f6000000-0000-4000-8000-000000000001'
  AND NOT EXISTS (SELECT 1 FROM public.resume_contact_focus_translations t
    WHERE t.focus_item_id=p.id AND t.resume_id=p.resume_id AND t.locale=v.locale);

WITH desired(id,ordinal,status_type) AS (VALUES
 ('f6000000-0000-4000-8000-000000000111'::uuid,1,'study'),('f6000000-0000-4000-8000-000000000112',2,'graduation'),('f6000000-0000-4000-8000-000000000113',3,'open')),
missing AS (SELECT d.* FROM desired d WHERE NOT EXISTS (SELECT 1 FROM public.resume_contact_status_items p WHERE p.id=d.id AND p.resume_id='f6000000-0000-4000-8000-000000000001')),
base AS (SELECT COALESCE(max(position),-1) AS position FROM public.resume_contact_status_items WHERE resume_id='f6000000-0000-4000-8000-000000000001')
INSERT INTO public.resume_contact_status_items(id,resume_id,position,status_type)
SELECT m.id,'f6000000-0000-4000-8000-000000000001',b.position+row_number() OVER(ORDER BY m.ordinal),m.status_type FROM missing m CROSS JOIN base b;
INSERT INTO public.resume_contact_status_translations(status_item_id,resume_id,locale,title,detail)
SELECT p.id,p.resume_id,v.locale,v.title,v.detail FROM public.resume_contact_status_items p JOIN (VALUES
 ('f6000000-0000-4000-8000-000000000111'::uuid,'zh','学习状态','持续学习服务设计与无障碍实践'),('f6000000-0000-4000-8000-000000000111','en','Learning','Continuing to study service design and accessibility practice'),
 ('f6000000-0000-4000-8000-000000000112','zh','毕业状态','已完成虚构的交互设计学士课程'),('f6000000-0000-4000-8000-000000000112','en','Graduation','Completed the fictional interaction design degree'),
 ('f6000000-0000-4000-8000-000000000113','zh','合作状态','欢迎讨论研究、原型与早期产品合作。'),('f6000000-0000-4000-8000-000000000113','en','Availability','Open to research, prototyping, and early-stage product collaborations.')
) AS v(id,locale,title,detail) ON v.id=p.id WHERE p.resume_id='f6000000-0000-4000-8000-000000000001'
  AND NOT EXISTS (SELECT 1 FROM public.resume_contact_status_translations t
    WHERE t.status_item_id=p.id AND t.resume_id=p.resume_id AND t.locale=v.locale);

DO $postflight$
DECLARE
  target constant uuid := 'f6000000-0000-4000-8000-000000000001';
  spec record;
  expected record;
  fixture_key text;
  fixture_locale text;
  row_count integer;
BEGIN
  -- Check each natural-key parent and each bilingual child against its exact
  -- parent ID and Test resume. Counts alone could accept the wrong rows.
  FOR spec IN SELECT * FROM (VALUES
    ('resume_intro_paragraphs','resume_intro_paragraph_translations','paragraph_id',ARRAY['test-preview-v1-intro-1','test-preview-v1-intro-2','test-preview-v1-intro-3']),
    ('resume_education_entries','resume_education_translations','education_entry_id',ARRAY['test-preview-v1-education-1','test-preview-v1-education-2']),
    ('resume_experience_entries','resume_experience_translations','experience_entry_id',ARRAY['test-preview-v1-experience-1','test-preview-v1-experience-2']),
    ('resume_project_entries','resume_project_translations','project_entry_id',ARRAY['test-preview-v1-project-1','test-preview-v1-project-2']),
    ('resume_skill_groups','resume_skill_group_translations','skill_group_id',ARRAY['test-preview-v1-skill-1','test-preview-v1-skill-2','test-preview-v1-skill-3']),
    ('resume_award_entries','resume_award_translations','award_entry_id',ARRAY['test-preview-v1-award-1','test-preview-v1-award-2'])
  ) AS required(parent_table,translation_table,parent_column,source_keys) LOOP
    FOREACH fixture_key IN ARRAY spec.source_keys LOOP
      EXECUTE format('SELECT count(*) FROM public.%I WHERE resume_id=$1 AND source_key=$2', spec.parent_table)
        INTO row_count USING target,fixture_key;
      IF row_count<>1 THEN
        RAISE EXCEPTION 'Fixture parent % / % is missing or ambiguous', spec.parent_table,fixture_key;
      END IF;
      FOREACH fixture_locale IN ARRAY ARRAY['zh','en'] LOOP
        EXECUTE format('SELECT count(*) FROM public.%I child JOIN public.%I parent ON parent.id=child.%I WHERE parent.resume_id=$1 AND parent.source_key=$2 AND child.resume_id=$1 AND child.locale=$3',
          spec.translation_table,spec.parent_table,spec.parent_column)
          INTO row_count USING target,fixture_key,fixture_locale;
        IF row_count<>1 THEN
          RAISE EXCEPTION 'Fixture translation % / % / % is missing or ambiguous', spec.translation_table,fixture_key,fixture_locale;
        END IF;
      END LOOP;
      EXECUTE format('SELECT count(*) FROM public.%I child JOIN public.%I parent ON parent.id=child.%I WHERE parent.resume_id=$1 AND parent.source_key=$2',
        spec.translation_table,spec.parent_table,spec.parent_column)
        INTO row_count USING target,fixture_key;
      IF row_count<>2 THEN
        RAISE EXCEPTION 'Fixture parent % / % has an extra or cross-resume translation', spec.parent_table,fixture_key;
      END IF;
    END LOOP;
  END LOOP;

  IF NOT EXISTS (SELECT 1 FROM public.resume_education_entries
      WHERE resume_id=target AND source_key='test-preview-v1-education-1'
        AND entry_type='standard' AND education_category='undergraduate')
    OR NOT EXISTS (SELECT 1 FROM public.resume_education_entries
      WHERE resume_id=target AND source_key='test-preview-v1-education-2'
        AND entry_type='summerSchool' AND education_category='summerSchool') THEN
    RAISE EXCEPTION 'Fixture Education entry type or category differs from its intended identity';
  END IF;

  FOR expected IN SELECT * FROM (VALUES
    ('f6000000-0000-4000-8000-000000000121'::uuid,'test-preview-v1-project-1','zh'),
    ('f6000000-0000-4000-8000-000000000122'::uuid,'test-preview-v1-project-1','zh'),
    ('f6000000-0000-4000-8000-000000000123'::uuid,'test-preview-v1-project-1','en'),
    ('f6000000-0000-4000-8000-000000000124'::uuid,'test-preview-v1-project-1','en'),
    ('f6000000-0000-4000-8000-000000000125'::uuid,'test-preview-v1-project-2','zh'),
    ('f6000000-0000-4000-8000-000000000126'::uuid,'test-preview-v1-project-2','en')
  ) AS required(id,source_key,locale) LOOP
    SELECT count(*) INTO row_count FROM public.resume_project_methods method
    JOIN public.resume_project_entries project ON project.id=method.project_entry_id
    WHERE method.id=expected.id AND method.resume_id=target AND project.resume_id=target
      AND project.source_key=expected.source_key AND method.locale=expected.locale;
    IF row_count<>1 THEN
      RAISE EXCEPTION 'Fixture project method % has the wrong parent, locale, or resume', expected.id;
    END IF;
  END LOOP;

  FOR expected IN SELECT * FROM (VALUES
    ('f6000000-0000-4000-8000-000000000101'::uuid),
    ('f6000000-0000-4000-8000-000000000102'::uuid)
  ) AS required(id) LOOP
    SELECT count(*) INTO row_count FROM public.resume_contact_focus_items WHERE id=expected.id AND resume_id=target;
    IF row_count<>1 THEN RAISE EXCEPTION 'Fixture focus item % has the wrong identity', expected.id; END IF;
    FOREACH fixture_locale IN ARRAY ARRAY['zh','en'] LOOP
      SELECT count(*) INTO row_count FROM public.resume_contact_focus_translations
      WHERE focus_item_id=expected.id AND resume_id=target AND locale=fixture_locale;
      IF row_count<>1 THEN RAISE EXCEPTION 'Fixture focus translation % / % is missing or misbound', expected.id,fixture_locale; END IF;
    END LOOP;
    SELECT count(*) INTO row_count FROM public.resume_contact_focus_translations WHERE focus_item_id=expected.id;
    IF row_count<>2 THEN RAISE EXCEPTION 'Fixture focus item % has extra translations', expected.id; END IF;
  END LOOP;

  FOR expected IN SELECT * FROM (VALUES
    ('f6000000-0000-4000-8000-000000000111'::uuid,'study'),
    ('f6000000-0000-4000-8000-000000000112'::uuid,'graduation'),
    ('f6000000-0000-4000-8000-000000000113'::uuid,'open')
  ) AS required(id,status_type) LOOP
    SELECT count(*) INTO row_count FROM public.resume_contact_status_items
    WHERE id=expected.id AND resume_id=target AND status_type=expected.status_type;
    IF row_count<>1 THEN RAISE EXCEPTION 'Fixture status item % has the wrong identity or type', expected.id; END IF;
    FOREACH fixture_locale IN ARRAY ARRAY['zh','en'] LOOP
      SELECT count(*) INTO row_count FROM public.resume_contact_status_translations
      WHERE status_item_id=expected.id AND resume_id=target AND locale=fixture_locale;
      IF row_count<>1 THEN RAISE EXCEPTION 'Fixture status translation % / % is missing or misbound', expected.id,fixture_locale; END IF;
    END LOOP;
    SELECT count(*) INTO row_count FROM public.resume_contact_status_translations WHERE status_item_id=expected.id;
    IF row_count<>2 THEN RAISE EXCEPTION 'Fixture status item % has extra translations', expected.id; END IF;
  END LOOP;

  IF (SELECT count(*) FROM public.resume_sites WHERE id=target AND site_key='example-cv-qa-activity-log' AND is_published=false)<>1
    OR (SELECT count(*) FROM public.cms_admins WHERE role='qa' AND resume_id=target)<>1
    OR EXISTS (SELECT 1 FROM cms_private.resume_capabilities WHERE resume_id=target AND capability_key='restore' AND enabled=true) THEN
    RAISE EXCEPTION 'Target identity, unpublished state, membership, or Restore state changed';
  END IF;
  IF (SELECT count(*) FROM public.resume_navigation_items WHERE resume_id=target)<>5
    OR (SELECT count(*) FROM public.resume_navigation_item_translations WHERE resume_id=target)<>10 THEN
    RAISE EXCEPTION 'Previously repaired Test Navigation changed unexpectedly';
  END IF;
END
$postflight$;

-- COMMIT is part of this separately approved, single-transaction script.
-- All preflight and postflight assertions run before it; any failure aborts
-- the transaction. Review the script and live preconditions before execution,
-- not between the postflight DO block and COMMIT.
COMMIT;
