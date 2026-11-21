DECLARE w record; before jsonb; after jsonb; rows integer; denied boolean:=false;
BEGIN
 SELECT * INTO STRICT w FROM site_private.business_identity();
 IF session_user<>'ecv_s3_internal_api_login' OR current_setting('role')<>'authenticated'
    OR target IS DISTINCT FROM '@SITE@'::uuid OR request_key IS DISTINCT FROM '@REQUEST@'::uuid
    OR w.uid<>'@UID@'::uuid OR w.sid<>'@SID@'::uuid
 THEN RAISE EXCEPTION 'S36_OWNER_FIXTURE_SCOPE' USING ERRCODE='PT403'; END IF;
 before:=site_api.read_introduction(target);
 IF (before->>'draft_revision')::integer<>5 THEN RAISE EXCEPTION 'S36_OWNER_FIXTURE_BASELINE'; END IF;
 BEGIN
   PERFORM set_config('s36_test.owner_remove','@REQUEST@',true);
   DELETE FROM site_data.site_members WHERE site_id=target AND auth_user_id=w.uid AND role='owner' AND state='active';
   GET DIAGNOSTICS rows=ROW_COUNT;
   IF rows<>1 OR EXISTS(SELECT FROM site_data.site_members WHERE site_id=target AND auth_user_id=w.uid)
   THEN RAISE EXCEPTION 'S36_OWNER_FIXTURE_NOT_APPLIED'; END IF;
   BEGIN
     PERFORM site_api.read_introduction(target);
     RAISE EXCEPTION 'S36_OWNER_RPC_ACCEPTED_MISSING_MIRROR';
   EXCEPTION WHEN SQLSTATE '42501' THEN
     IF SQLERRM<>'BUSINESS_DENIED' THEN RAISE; END IF;
     denied:=true;
   END;
   RAISE EXCEPTION 'S36_OWNER_FIXTURE_ROLLBACK' USING ERRCODE='PZ057';
 EXCEPTION WHEN SQLSTATE 'PZ057' THEN
   IF SQLERRM<>'S36_OWNER_FIXTURE_ROLLBACK' THEN RAISE; END IF;
 END;
 after:=site_api.read_introduction(target);
 IF NOT denied OR before IS DISTINCT FROM after
    OR NOT EXISTS(SELECT FROM site_data.site_members WHERE site_id=target AND auth_user_id=w.uid AND state='active' AND role='owner')
 THEN RAISE EXCEPTION 'S36_OWNER_FIXTURE_RESTORE'; END IF;
 RETURN jsonb_build_object('request_key',request_key,'same_transaction',true,'missing_row_count',rows,
     'rpc_sqlstate','42501','rpc_denial','BUSINESS_DENIED','restored',true,'draft_revision',5);
END;
