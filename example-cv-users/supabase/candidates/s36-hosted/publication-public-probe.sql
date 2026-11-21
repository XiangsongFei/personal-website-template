-- Separate approval required. psql variable: alice_site. The test hostname is resolved locally.
BEGIN;
\ir publication-target.sql
SELECT set_config('s36_test.public_site',:'alice_site',true) AS site
\gset
GRANT ecv_s3_owner TO postgres WITH ADMIN FALSE,INHERIT TRUE,SET FALSE GRANTED BY postgres;
DO $domain$
DECLARE host text;
BEGIN
  UPDATE site_data.site_domains
    SET state='active',verified_at=clock_timestamp()
    WHERE site_id=current_setting('s36_test.public_site')::uuid AND kind='test' AND is_primary AND state='reserved'
      AND verified_at IS NULL AND hostname_normalized ~ '^[a-z][a-z0-9-]{1,46}[a-z0-9]\.sites\.example\.test$'
    RETURNING hostname_normalized INTO STRICT host;
  PERFORM set_config('s36_test.public_host',host,true);
  UPDATE site_private.text_publication_runtime SET public_read_enabled=true WHERE singleton AND NOT public_read_enabled;
  IF NOT FOUND THEN RAISE EXCEPTION 'S36_PUBLIC_PROBE_GATE'; END IF;
END;
$domain$;
SET LOCAL ROLE anon;
DO $probe$
DECLARE projection jsonb;
BEGIN
  BEGIN
    projection:=public.read_public_text(current_setting('s36_test.public_host'),'en');
  EXCEPTION WHEN SQLSTATE 'PT404' THEN
    projection:=jsonb_build_object('status','not_found','sqlstate','PT404');
  END;
  PERFORM set_config('s36_test.public_json',projection::text,true);
END;
$probe$;
SELECT current_setting('s36_test.public_json')::jsonb;
ROLLBACK;
