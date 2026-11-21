DECLARE
  operation site_private.operation_requests%ROWTYPE;
BEGIN
  IF TG_OP <> 'INSERT' OR TG_TABLE_SCHEMA <> 'site_private' OR TG_TABLE_NAME <> 'text_publication_audit'
     OR NEW.site_id <> '@SITE@'::uuid OR NEW.actor_auth_user_id <> '@UID@'::uuid
     OR NEW.actor_session_id <> '@SID@'::uuid OR NEW.action <> 'save_text_draft'
     OR NEW.draft_revision <> 6 OR NEW.publication_revision <> 2 THEN
    RETURN NULL;
  END IF;

  SELECT * INTO operation FROM site_private.operation_requests o
  WHERE o.site_id = NEW.site_id AND o.id = NEW.operation_id
    AND o.actor_auth_user_id = NEW.actor_auth_user_id AND o.actor_session_id = NEW.actor_session_id
    AND o.operation = 'save_text_draft' AND o.request_id = '@REQUEST@'::uuid
    AND o.payload_digest = '@DIGEST@' AND o.digest_encoding = 'js-json-stringify-v1';
  IF NOT FOUND THEN RETURN NULL; END IF;

  IF operation.state <> 'succeeded' OR operation.basis_draft_revision <> 5 OR operation.basis_publication_revision <> 2
     OR NOT EXISTS (
       SELECT FROM site_data.sites s
       JOIN site_data.section_state q ON q.site_id = s.id AND q.section_key = 'introduction' AND q.revision = 6
       JOIN site_data.draft_revisions h ON h.site_id = s.id AND h.site_revision = 6
         AND h.previous_revision = 5 AND h.operation_id = operation.id AND h.actor_auth_user_id = NEW.actor_auth_user_id
       JOIN site_data.site_publications p ON p.site_id = s.id
         AND p.state = 'unpublished' AND p.snapshot_id IS NULL AND p.publication_revision = 2
       WHERE s.id = NEW.site_id AND s.owner_auth_user_id = NEW.actor_auth_user_id AND s.draft_revision = 6
     ) THEN
    RAISE EXCEPTION 'S36_TEST_EFFECT_WITNESS_MISSING' USING ERRCODE = 'PT537';
  END IF;

  RAISE EXCEPTION 'S36_TEST_DEFERRED_AFTER_SAVE_EFFECTS' USING ERRCODE = 'PT536';
END;
