-- NOT RUN. Post-M4 catalog-only candidate; no JWT or signer-success evidence.
-- Run separately from the historical A-only permission suite.
\set ON_ERROR_STOP on
BEGIN READ ONLY;
SET LOCAL search_path=pg_catalog;
DO $test$
DECLARE acl_contract constant jsonb := $contract$
{
  "auth_bridge": {
    "caller": "verified PostgREST JWT only; session_user=authenticator; role=authenticated; no SQL login/GUC simulation acceptance",
    "execute": [
      "postgres",
      "ecv_s3_authz_reader"
    ],
    "owner": "postgres",
    "returns": "TABLE(uid uuid, sid uuid)",
    "signature": "site_private.auth_source_identity()"
  },
  "auth_source_columns": {
    "auth.sessions": [
      "id",
      "user_id",
      "not_after"
    ],
    "auth.users": [
      "id",
      "email_confirmed_at",
      "banned_until",
      "is_anonymous"
    ]
  },
  "columns": [
    [
      "site_private.user_security_state",
      "security_epoch",
      "ecv_s3_grant_writer",
      "UPDATE"
    ],
    [
      "site_private.business_session_grants",
      "last_renewed_at",
      "ecv_s3_grant_writer",
      "UPDATE"
    ],
    [
      "site_private.business_session_grants",
      "expires_at",
      "ecv_s3_grant_writer",
      "UPDATE"
    ],
    [
      "site_private.business_session_grants",
      "revoked_at",
      "ecv_s3_grant_writer",
      "UPDATE"
    ],
    [
      "site_private.business_session_grants",
      "reason",
      "ecv_s3_grant_writer",
      "UPDATE"
    ],
    [
      "site_data.sites",
      "id",
      "ecv_s3_command_writer",
      "SELECT"
    ],
    [
      "site_data.sites",
      "owner_auth_user_id",
      "ecv_s3_command_writer",
      "SELECT"
    ],
    [
      "site_data.sites",
      "status",
      "ecv_s3_command_writer",
      "SELECT"
    ],
    [
      "site_data.sites",
      "draft_revision",
      "ecv_s3_command_writer",
      "SELECT"
    ],
    [
      "site_data.site_members",
      "site_id",
      "ecv_s3_command_writer",
      "SELECT"
    ],
    [
      "site_data.site_members",
      "auth_user_id",
      "ecv_s3_command_writer",
      "SELECT"
    ],
    [
      "site_data.site_members",
      "role",
      "ecv_s3_command_writer",
      "SELECT"
    ],
    [
      "site_data.site_members",
      "state",
      "ecv_s3_command_writer",
      "SELECT"
    ],
    [
      "site_data.site_publications",
      "site_id",
      "ecv_s3_command_writer",
      "SELECT"
    ],
    [
      "site_data.site_publications",
      "state",
      "ecv_s3_command_writer",
      "SELECT"
    ],
    [
      "site_data.site_publications",
      "snapshot_id",
      "ecv_s3_command_writer",
      "SELECT"
    ],
    [
      "site_data.site_publications",
      "publication_revision",
      "ecv_s3_command_writer",
      "SELECT"
    ],
    [
      "site_data.site_locales",
      "site_id",
      "ecv_s3_command_writer",
      "SELECT"
    ],
    [
      "site_data.site_locales",
      "locale",
      "ecv_s3_command_writer",
      "SELECT"
    ],
    [
      "site_data.site_locales",
      "enabled",
      "ecv_s3_command_writer",
      "SELECT"
    ],
    [
      "site_data.intro_entries",
      "id",
      "ecv_s3_command_writer",
      "SELECT"
    ],
    [
      "site_data.intro_entries",
      "site_id",
      "ecv_s3_command_writer",
      "SELECT"
    ],
    [
      "site_data.intro_entries",
      "position",
      "ecv_s3_command_writer",
      "SELECT"
    ],
    [
      "site_data.intro_translations",
      "site_id",
      "ecv_s3_command_writer",
      "SELECT"
    ],
    [
      "site_data.intro_translations",
      "parent_id",
      "ecv_s3_command_writer",
      "SELECT"
    ],
    [
      "site_data.intro_translations",
      "locale",
      "ecv_s3_command_writer",
      "SELECT"
    ],
    [
      "site_data.intro_translations",
      "text",
      "ecv_s3_command_writer",
      "SELECT"
    ],
    [
      "site_private.operation_requests",
      "id",
      "ecv_s3_command_writer",
      "SELECT"
    ],
    [
      "site_private.operation_requests",
      "site_id",
      "ecv_s3_command_writer",
      "SELECT"
    ],
    [
      "site_private.operation_requests",
      "actor_auth_user_id",
      "ecv_s3_command_writer",
      "SELECT"
    ],
    [
      "site_private.operation_requests",
      "operation",
      "ecv_s3_command_writer",
      "SELECT"
    ],
    [
      "site_private.operation_requests",
      "request_id",
      "ecv_s3_command_writer",
      "SELECT"
    ],
    [
      "site_private.operation_requests",
      "payload_digest",
      "ecv_s3_command_writer",
      "SELECT"
    ],
    [
      "site_private.operation_requests",
      "result",
      "ecv_s3_command_writer",
      "SELECT"
    ]
  ],
  "functions": {
    "site_api.apply_business_grant(jsonb)": {
      "body_sha256": "e8635ef5eebe1cb681ee14b3d14041d324f8b55fcaee801c6610bd61dc749c77",
      "execute": [
        "ecv_s3_grant_writer",
        "authenticated"
      ],
      "language": "plpgsql",
      "owner": "ecv_s3_grant_writer",
      "returns": "jsonb",
      "security_definer": true
    },
    "site_api.create_site(jsonb)": {
      "body_sha256": "018ada4d6b24342710fe2619f470490a4d253a5e2b626da5b9e649d3f3402fde",
      "execute": [
        "ecv_s3_command_writer",
        "authenticated"
      ],
      "language": "plpgsql",
      "owner": "ecv_s3_command_writer",
      "returns": "jsonb",
      "security_definer": true
    },
    "site_api.get_my_site()": {
      "body_sha256": "4b842a6e004ea5ba234f2f7a1a17aeeae47171126bf5cd0e6a1a13fa2bc536db",
      "execute": [
        "ecv_s3_command_writer",
        "authenticated"
      ],
      "language": "plpgsql",
      "owner": "ecv_s3_command_writer",
      "returns": "jsonb",
      "security_definer": true
    },
    "site_api.read_create_operation(jsonb)": {
      "body_sha256": "394a6c6106bdee2a691f05797e4eac339fcfae46732fdd667b8b7acf839ca5e3",
      "execute": [
        "ecv_s3_command_writer",
        "authenticated"
      ],
      "language": "plpgsql",
      "owner": "ecv_s3_command_writer",
      "returns": "jsonb",
      "security_definer": true
    },
    "site_api.read_introduction(uuid)": {
      "body_sha256": "26c40603f260c707a099b646e73d222fada1740d66ca6493fcebd5c2b572f9f2",
      "execute": [
        "ecv_s3_command_writer",
        "authenticated"
      ],
      "language": "plpgsql",
      "owner": "ecv_s3_command_writer",
      "returns": "jsonb",
      "security_definer": true
    },
    "site_private.assert_site_integrity()": {
      "body_sha256": "1aa8c6b6dd838b32b863936c13e5b12fcb335f9b20b238dcae24201fd3933654",
      "execute": [
        "ecv_s3_integrity"
      ],
      "language": "plpgsql",
      "owner": "ecv_s3_integrity",
      "returns": "trigger",
      "security_definer": true
    },
    "site_private.auth_source_identity()": {
      "body_sha256": "7db3478abab4eeb6dd991ee232299899b4565d772bee0534c8dbdcb99199e329",
      "execute": [
        "postgres",
        "ecv_s3_authz_reader"
      ],
      "language": "plpgsql",
      "owner": "postgres",
      "returns": "TABLE(uid uuid, sid uuid)",
      "security_definer": true
    },
    "site_private.business_identity()": {
      "body_sha256": "1ef8902b880bb2a3c2979daf4207b0704f2db5ca08253f3ad574083882a5b6bb",
      "execute": [
        "ecv_s3_authz_reader",
        "ecv_s3_grant_writer",
        "ecv_s3_command_writer"
      ],
      "language": "plpgsql",
      "owner": "ecv_s3_authz_reader",
      "returns": "TABLE(uid uuid, sid uuid)",
      "security_definer": true
    },
    "site_private.business_qualified()": {
      "body_sha256": "beda745cdcb5af018c3561f96b19f611f4be991f096e91ddb58e05373fa5ae05",
      "execute": [
        "ecv_s3_authz_reader",
        "ecv_s3_grant_writer",
        "ecv_s3_command_writer"
      ],
      "language": "plpgsql",
      "owner": "ecv_s3_authz_reader",
      "returns": "boolean",
      "security_definer": true
    },
    "site_private.business_site_complete(uuid)": {
      "body_sha256": "5870afd7011b08d2cf83ca4c1ab1b2da5dcb5b52fecf81dccb216325576aa469",
      "execute": [
        "ecv_s3_authz_reader",
        "ecv_s3_command_writer"
      ],
      "language": "sql",
      "owner": "ecv_s3_authz_reader",
      "returns": "boolean",
      "security_definer": true
    },
    "site_private.business_site_owned(uuid)": {
      "body_sha256": "e3de7aabc72db5c99c78fbe12d42d556642d19899d074ac1f9f7fdab8727ec48",
      "execute": [
        "ecv_s3_authz_reader",
        "ecv_s3_command_writer"
      ],
      "language": "sql",
      "owner": "ecv_s3_authz_reader",
      "returns": "boolean",
      "security_definer": true
    },
    "site_private.create_payload(jsonb)": {
      "body_sha256": "06cc2e88f8dc414ab21c823358bc1282ef949e8dffb46cfcebfa1ff2d9cbcb4c",
      "execute": [
        "ecv_s3_command_writer"
      ],
      "language": "plpgsql",
      "owner": "ecv_s3_command_writer",
      "returns": "text",
      "security_definer": false
    },
    "site_private.guard_business_grant()": {
      "body_sha256": "3fa8eb7ad8675b3cebb50f984d6d6e55d2ae07a0c75a84b5e4f659a446f701e4",
      "execute": [
        "ecv_s3_owner"
      ],
      "language": "plpgsql",
      "owner": "ecv_s3_owner",
      "returns": "trigger",
      "security_definer": false
    },
    "site_private.guard_identity()": {
      "body_sha256": "48fb0e02527907dc2af659fa5247d353829dddeb06d681b28cdad51d39588323",
      "execute": [
        "ecv_s3_owner"
      ],
      "language": "plpgsql",
      "owner": "ecv_s3_owner",
      "returns": "trigger",
      "security_definer": false
    },
    "site_private.guard_security_state()": {
      "body_sha256": "73b661afbb97bad2ff9626e70e6f13ee2b5e841053ab4e8adcb8234133d6b0ed",
      "execute": [
        "ecv_s3_owner"
      ],
      "language": "plpgsql",
      "owner": "ecv_s3_owner",
      "returns": "trigger",
      "security_definer": false
    },
    "site_private.lock_business_qualification()": {
      "body_sha256": "06615d63c92689a1f646ea64c6b8e47381bc6a9325b968b8c1bf5c9b16bf824f",
      "execute": [
        "ecv_s3_grant_writer",
        "ecv_s3_command_writer"
      ],
      "language": "plpgsql",
      "owner": "ecv_s3_grant_writer",
      "returns": "TABLE(uid uuid, sid uuid)",
      "security_definer": true
    },
    "site_private.reject_mutation()": {
      "body_sha256": "77f6fdcb68b54c15eb3ad8ccd72d5bd657e656b536ff970886d505786c2bf334",
      "execute": [
        "ecv_s3_owner"
      ],
      "language": "plpgsql",
      "owner": "ecv_s3_owner",
      "returns": "trigger",
      "security_definer": false
    },
    "site_private.request_uid()": {
      "body_sha256": "c047de1153332029c1159103240ad3faec15c725bc1f35d05b429d2a140e74b9",
      "execute": [
        "ecv_s3_authz_reader",
        "ecv_s3_grant_writer",
        "ecv_s3_command_writer"
      ],
      "language": "sql",
      "owner": "ecv_s3_authz_reader",
      "returns": "uuid",
      "security_definer": true
    },
    "site_private.verify_business_proof(jsonb,uuid,uuid)": {
      "body_sha256": "a1814ca04cd10561dfc63fd4d9dbad61b2e4f2c4a5a3b8b47efc3c8ef98b6d7f",
      "execute": [
        "ecv_s3_grant_writer"
      ],
      "language": "plpgsql",
      "owner": "ecv_s3_grant_writer",
      "returns": "jsonb",
      "security_definer": false
    }
  },
  "internal_roles": [
    "ecv_s3_owner",
    "ecv_s3_integrity",
    "ecv_s3_authz_reader",
    "ecv_s3_grant_writer",
    "ecv_s3_command_writer"
  ],
  "ordinary_roles": [
    "anon",
    "authenticated",
    "authenticator",
    "service_role"
  ],
  "permission_ddl": {
    "20261109104800_s3_business_grants.sql": [
      "grant ecv_s3_owner,ecv_s3_authz_reader,ecv_s3_grant_writer,ecv_s3_command_writer to postgres with admin false,inherit true,set true granted by postgres",
      "grant usage on schema site_private,site_data to ecv_s3_authz_reader",
      "grant usage on schema site_private,site_data,site_api,extensions to ecv_s3_grant_writer",
      "grant usage on schema site_private,site_data,site_api,extensions to ecv_s3_command_writer",
      "revoke all on site_private.business_runtime,site_private.business_proof_keys from public,anon,authenticated,authenticator,service_role",
      "grant select on site_private.business_runtime to ecv_s3_authz_reader,ecv_s3_grant_writer",
      "grant select on site_private.business_proof_keys to ecv_s3_grant_writer",
      "grant select on site_private.user_security_state,site_private.business_session_grants to ecv_s3_authz_reader",
      "grant select on site_data.sites,site_data.site_members to ecv_s3_authz_reader",
      "grant create on schema site_private to ecv_s3_authz_reader,ecv_s3_grant_writer",
      "grant create on schema site_api to ecv_s3_grant_writer",
      "grant select,insert on site_private.user_security_state to ecv_s3_grant_writer",
      "grant update(security_epoch)on site_private.user_security_state to ecv_s3_grant_writer",
      "grant select,insert on site_private.business_session_grants,site_private.grant_proofs to ecv_s3_grant_writer",
      "grant update(last_renewed_at,expires_at,revoked_at,reason)on site_private.business_session_grants to ecv_s3_grant_writer",
      "alter default privileges revoke execute on functions from public",
      "alter default privileges revoke execute on functions from public",
      "alter default privileges revoke execute on functions from public",
      "alter function site_private.auth_source_identity()owner to postgres",
      "revoke all on function site_private.auth_source_identity()from public,anon,authenticated,authenticator,service_role",
      "grant execute on function site_private.auth_source_identity()to ecv_s3_authz_reader",
      "alter function site_private.request_uid()owner to ecv_s3_authz_reader",
      "revoke all on function site_private.request_uid()from public,anon,authenticated,authenticator,service_role",
      "grant execute on function site_private.request_uid()to ecv_s3_grant_writer,ecv_s3_command_writer",
      "alter function site_private.business_identity()owner to ecv_s3_authz_reader",
      "revoke all on function site_private.business_identity()from public,anon,authenticated,authenticator,service_role",
      "grant execute on function site_private.business_identity()to ecv_s3_grant_writer,ecv_s3_command_writer",
      "alter function site_private.business_qualified()owner to ecv_s3_authz_reader",
      "revoke all on function site_private.business_qualified()from public,anon,authenticated,authenticator,service_role",
      "grant execute on function site_private.business_qualified()to ecv_s3_grant_writer,ecv_s3_command_writer",
      "alter function site_private.business_site_owned(uuid)owner to ecv_s3_authz_reader",
      "revoke all on function site_private.business_site_owned(uuid)from public,anon,authenticated,authenticator,service_role",
      "grant execute on function site_private.business_site_owned(uuid)to ecv_s3_command_writer",
      "alter function site_private.business_site_complete(uuid)owner to ecv_s3_authz_reader",
      "revoke all on function site_private.business_site_complete(uuid)from public,anon,authenticated,authenticator,service_role",
      "grant execute on function site_private.business_site_complete(uuid)to ecv_s3_command_writer",
      "alter function site_private.lock_business_qualification()owner to ecv_s3_grant_writer",
      "revoke all on function site_private.lock_business_qualification()from public,anon,authenticated,authenticator,service_role",
      "grant execute on function site_private.lock_business_qualification()to ecv_s3_command_writer",
      "alter function site_private.verify_business_proof(jsonb,uuid,uuid)owner to ecv_s3_grant_writer",
      "revoke all on function site_private.verify_business_proof(jsonb,uuid,uuid)from public,anon,authenticated,authenticator,service_role",
      "alter function site_private.guard_business_grant()owner to ecv_s3_owner",
      "revoke all on function site_private.guard_business_grant()from public,anon,authenticated,authenticator,service_role",
      "alter function site_api.apply_business_grant(jsonb)owner to ecv_s3_grant_writer",
      "revoke all on function site_api.apply_business_grant(jsonb)from public,anon,authenticated,authenticator,service_role",
      "grant execute on function site_api.apply_business_grant(jsonb)to authenticated",
      "grant usage on schema site_api to authenticated",
      "revoke create on schema site_private from ecv_s3_authz_reader,ecv_s3_grant_writer",
      "revoke create on schema site_api from ecv_s3_grant_writer",
      "revoke ecv_s3_owner,ecv_s3_authz_reader,ecv_s3_grant_writer,ecv_s3_command_writer from postgres granted by postgres restrict"
    ],
    "20261109104802_s3_create_site_commands.sql": [
      "grant ecv_s3_owner,ecv_s3_command_writer to postgres with admin false,inherit true,set true granted by postgres",
      "grant create on schema site_private,site_api to ecv_s3_command_writer",
      "grant insert on site_data.sites,site_data.site_members,site_data.site_domains,site_data.site_locales,site_data.site_settings,site_data.section_state,site_data.site_publications,site_data.intro_entries,site_data.intro_translations,site_data.draft_revisions,site_private.operation_requests,site_private.site_audit_events to ecv_s3_command_writer",
      "grant select(id,owner_auth_user_id,status,draft_revision)on site_data.sites to ecv_s3_command_writer",
      "grant select(site_id,auth_user_id,role,state)on site_data.site_members to ecv_s3_command_writer",
      "grant select(site_id,state,snapshot_id,publication_revision)on site_data.site_publications to ecv_s3_command_writer",
      "grant select(site_id,locale,enabled)on site_data.site_locales to ecv_s3_command_writer",
      "grant select(id,site_id,position)on site_data.intro_entries to ecv_s3_command_writer",
      "grant select(site_id,parent_id,locale,text)on site_data.intro_translations to ecv_s3_command_writer",
      "grant select(id,site_id,actor_auth_user_id,operation,request_id,payload_digest,result)on site_private.operation_requests to ecv_s3_command_writer",
      "alter function site_private.create_payload(jsonb)owner to ecv_s3_command_writer",
      "revoke all on function site_private.create_payload(jsonb)from public,anon,authenticated,authenticator,service_role",
      "alter function site_api.create_site(jsonb)owner to ecv_s3_command_writer",
      "revoke all on function site_api.create_site(jsonb)from public,anon,authenticated,authenticator,service_role",
      "grant execute on function site_api.create_site(jsonb)to authenticated",
      "alter function site_api.read_create_operation(jsonb)owner to ecv_s3_command_writer",
      "revoke all on function site_api.read_create_operation(jsonb)from public,anon,authenticated,authenticator,service_role",
      "grant execute on function site_api.read_create_operation(jsonb)to authenticated",
      "alter function site_api.get_my_site()owner to ecv_s3_command_writer",
      "revoke all on function site_api.get_my_site()from public,anon,authenticated,authenticator,service_role",
      "grant execute on function site_api.get_my_site()to authenticated",
      "alter function site_api.read_introduction(uuid)owner to ecv_s3_command_writer",
      "revoke all on function site_api.read_introduction(uuid)from public,anon,authenticated,authenticator,service_role",
      "grant execute on function site_api.read_introduction(uuid)to authenticated",
      "revoke create on schema site_private,site_api from ecv_s3_command_writer",
      "revoke ecv_s3_owner,ecv_s3_command_writer from postgres granted by postgres restrict"
    ]
  },
  "schema_effective_usage_create": {
    "auth": {
      "ecv_s3_authz_reader": [
        false,
        false
      ],
      "ecv_s3_command_writer": [
        false,
        false
      ],
      "ecv_s3_grant_writer": [
        false,
        false
      ],
      "ecv_s3_integrity": [
        false,
        false
      ],
      "ecv_s3_owner": [
        false,
        false
      ]
    },
    "extensions": {
      "ecv_s3_authz_reader": [
        null,
        false
      ],
      "ecv_s3_command_writer": [
        true,
        false
      ],
      "ecv_s3_grant_writer": [
        true,
        false
      ],
      "ecv_s3_integrity": [
        null,
        false
      ],
      "ecv_s3_owner": [
        null,
        false
      ]
    },
    "site_api": {
      "ecv_s3_authz_reader": [
        false,
        false
      ],
      "ecv_s3_command_writer": [
        true,
        false
      ],
      "ecv_s3_grant_writer": [
        true,
        false
      ],
      "ecv_s3_integrity": [
        false,
        false
      ],
      "ecv_s3_owner": [
        true,
        true
      ]
    },
    "site_data": {
      "ecv_s3_authz_reader": [
        true,
        false
      ],
      "ecv_s3_command_writer": [
        true,
        false
      ],
      "ecv_s3_grant_writer": [
        true,
        false
      ],
      "ecv_s3_integrity": [
        true,
        false
      ],
      "ecv_s3_owner": [
        true,
        true
      ]
    },
    "site_private": {
      "ecv_s3_authz_reader": [
        true,
        false
      ],
      "ecv_s3_command_writer": [
        true,
        false
      ],
      "ecv_s3_grant_writer": [
        true,
        false
      ],
      "ecv_s3_integrity": [
        true,
        false
      ],
      "ecv_s3_owner": [
        true,
        true
      ]
    }
  },
  "status": "R4 exact ACL specification; approved narrow postgres Auth bridge; offline only, not SQL execution evidence",
  "tables": {
    "site_data.draft_revisions": {
      "ecv_s3_command_writer": [
        "INSERT"
      ],
      "ecv_s3_owner": [
        "SELECT",
        "INSERT",
        "UPDATE",
        "DELETE",
        "TRUNCATE",
        "REFERENCES",
        "TRIGGER",
        "MAINTAIN"
      ]
    },
    "site_data.intro_entries": {
      "ecv_s3_command_writer": [
        "INSERT"
      ],
      "ecv_s3_owner": [
        "SELECT",
        "INSERT",
        "UPDATE",
        "DELETE",
        "TRUNCATE",
        "REFERENCES",
        "TRIGGER",
        "MAINTAIN"
      ]
    },
    "site_data.intro_translations": {
      "ecv_s3_command_writer": [
        "INSERT"
      ],
      "ecv_s3_owner": [
        "SELECT",
        "INSERT",
        "UPDATE",
        "DELETE",
        "TRUNCATE",
        "REFERENCES",
        "TRIGGER",
        "MAINTAIN"
      ]
    },
    "site_data.section_state": {
      "ecv_s3_command_writer": [
        "INSERT"
      ],
      "ecv_s3_owner": [
        "SELECT",
        "INSERT",
        "UPDATE",
        "DELETE",
        "TRUNCATE",
        "REFERENCES",
        "TRIGGER",
        "MAINTAIN"
      ]
    },
    "site_data.site_domains": {
      "ecv_s3_command_writer": [
        "INSERT"
      ],
      "ecv_s3_owner": [
        "SELECT",
        "INSERT",
        "UPDATE",
        "DELETE",
        "TRUNCATE",
        "REFERENCES",
        "TRIGGER",
        "MAINTAIN"
      ]
    },
    "site_data.site_locales": {
      "ecv_s3_command_writer": [
        "INSERT"
      ],
      "ecv_s3_owner": [
        "SELECT",
        "INSERT",
        "UPDATE",
        "DELETE",
        "TRUNCATE",
        "REFERENCES",
        "TRIGGER",
        "MAINTAIN"
      ]
    },
    "site_data.site_members": {
      "ecv_s3_authz_reader": [
        "SELECT"
      ],
      "ecv_s3_command_writer": [
        "INSERT"
      ],
      "ecv_s3_integrity": [
        "SELECT"
      ],
      "ecv_s3_owner": [
        "SELECT",
        "INSERT",
        "UPDATE",
        "DELETE",
        "TRUNCATE",
        "REFERENCES",
        "TRIGGER",
        "MAINTAIN"
      ]
    },
    "site_data.site_publications": {
      "ecv_s3_command_writer": [
        "INSERT"
      ],
      "ecv_s3_integrity": [
        "SELECT"
      ],
      "ecv_s3_owner": [
        "SELECT",
        "INSERT",
        "UPDATE",
        "DELETE",
        "TRUNCATE",
        "REFERENCES",
        "TRIGGER",
        "MAINTAIN"
      ]
    },
    "site_data.site_settings": {
      "ecv_s3_command_writer": [
        "INSERT"
      ],
      "ecv_s3_owner": [
        "SELECT",
        "INSERT",
        "UPDATE",
        "DELETE",
        "TRUNCATE",
        "REFERENCES",
        "TRIGGER",
        "MAINTAIN"
      ]
    },
    "site_data.sites": {
      "ecv_s3_authz_reader": [
        "SELECT"
      ],
      "ecv_s3_command_writer": [
        "INSERT"
      ],
      "ecv_s3_integrity": [
        "SELECT"
      ],
      "ecv_s3_owner": [
        "SELECT",
        "INSERT",
        "UPDATE",
        "DELETE",
        "TRUNCATE",
        "REFERENCES",
        "TRIGGER",
        "MAINTAIN"
      ]
    },
    "site_private.business_proof_keys": {
      "ecv_s3_grant_writer": [
        "SELECT"
      ],
      "ecv_s3_owner": [
        "SELECT",
        "INSERT",
        "UPDATE",
        "DELETE",
        "TRUNCATE",
        "REFERENCES",
        "TRIGGER",
        "MAINTAIN"
      ]
    },
    "site_private.business_runtime": {
      "ecv_s3_authz_reader": [
        "SELECT"
      ],
      "ecv_s3_grant_writer": [
        "SELECT"
      ],
      "ecv_s3_owner": [
        "SELECT",
        "INSERT",
        "UPDATE",
        "DELETE",
        "TRUNCATE",
        "REFERENCES",
        "TRIGGER",
        "MAINTAIN"
      ]
    },
    "site_private.business_session_grants": {
      "ecv_s3_authz_reader": [
        "SELECT"
      ],
      "ecv_s3_grant_writer": [
        "SELECT",
        "INSERT"
      ],
      "ecv_s3_owner": [
        "SELECT",
        "INSERT",
        "UPDATE",
        "DELETE",
        "TRUNCATE",
        "REFERENCES",
        "TRIGGER",
        "MAINTAIN"
      ]
    },
    "site_private.grant_proofs": {
      "ecv_s3_grant_writer": [
        "SELECT",
        "INSERT"
      ],
      "ecv_s3_owner": [
        "SELECT",
        "INSERT",
        "UPDATE",
        "DELETE",
        "TRUNCATE",
        "REFERENCES",
        "TRIGGER",
        "MAINTAIN"
      ]
    },
    "site_private.operation_requests": {
      "ecv_s3_command_writer": [
        "INSERT"
      ],
      "ecv_s3_owner": [
        "SELECT",
        "INSERT",
        "UPDATE",
        "DELETE",
        "TRUNCATE",
        "REFERENCES",
        "TRIGGER",
        "MAINTAIN"
      ]
    },
    "site_private.site_audit_events": {
      "ecv_s3_command_writer": [
        "INSERT"
      ],
      "ecv_s3_owner": [
        "SELECT",
        "INSERT",
        "UPDATE",
        "DELETE",
        "TRUNCATE",
        "REFERENCES",
        "TRIGGER",
        "MAINTAIN"
      ]
    },
    "site_private.user_security_state": {
      "ecv_s3_authz_reader": [
        "SELECT"
      ],
      "ecv_s3_grant_writer": [
        "SELECT",
        "INSERT"
      ],
      "ecv_s3_owner": [
        "SELECT",
        "INSERT",
        "UPDATE",
        "DELETE",
        "TRUNCATE",
        "REFERENCES",
        "TRIGGER",
        "MAINTAIN"
      ]
    }
  }
}
$contract$;
 spec record; obj record; role_oid oid; expected boolean; actual boolean;
 role_name text; r record; privilege_name text; expected_owner text;
 internals oid[]:=ARRAY['ecv_s3_owner'::regrole::oid,'ecv_s3_integrity'::regrole::oid,
  'ecv_s3_authz_reader'::regrole::oid,'ecv_s3_grant_writer'::regrole::oid,'ecv_s3_command_writer'::regrole::oid];
BEGIN
 IF current_user<>'postgres' OR session_user<>'postgres' THEN RAISE EXCEPTION 'test identity mismatch'; END IF;
 IF (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname IN ('site_data','site_private') AND c.relkind='r')<>17 THEN RAISE EXCEPTION 'table inventory'; END IF;
 FOR r IN SELECT c.* FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname IN ('site_data','site_private') AND c.relkind='r' LOOP
  IF r.relowner<>'ecv_s3_owner'::regrole OR NOT r.relrowsecurity OR NOT r.relforcerowsecurity THEN RAISE EXCEPTION 'table boundary'; END IF;
  FOREACH role_name IN ARRAY ARRAY['anon','authenticated','authenticator','service_role'] LOOP
   FOREACH privilege_name IN ARRAY ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN'] LOOP
    IF has_table_privilege(role_name,r.oid,privilege_name) THEN RAISE EXCEPTION 'ordinary table privilege'; END IF;
    IF privilege_name IN ('SELECT','INSERT','UPDATE','REFERENCES') AND has_any_column_privilege(role_name,r.oid,privilege_name) THEN
     RAISE EXCEPTION 'ordinary column privilege'; END IF;
   END LOOP;
  END LOOP;
 END LOOP;
 IF (SELECT count(*) FROM pg_roles WHERE oid=ANY(internals) AND NOT rolcanlogin AND NOT rolinherit AND NOT rolsuper
  AND NOT rolbypassrls AND NOT rolcreaterole AND NOT rolcreatedb AND NOT rolreplication)<>5 THEN RAISE EXCEPTION 'role flags'; END IF;
 IF NOT EXISTS(SELECT FROM pg_roles WHERE oid=10 AND rolname='supabase_admin' AND rolsuper) THEN RAISE EXCEPTION 'bootstrap identity'; END IF;
 IF (SELECT count(*) FROM pg_auth_members WHERE roleid=ANY(internals) OR member=ANY(internals))<>5
  OR (SELECT count(*) FROM pg_auth_members WHERE roleid=ANY(internals) AND member='postgres'::regrole
   AND grantor=10 AND admin_option AND NOT set_option AND NOT inherit_option)<>5 THEN RAISE EXCEPTION 'bootstrap membership'; END IF;
 FOR r IN SELECT x.oid AS roleid FROM pg_roles x WHERE x.oid=ANY(internals) LOOP
  IF pg_has_role('postgres',r.roleid,'SET') OR pg_has_role('postgres',r.roleid,'USAGE') THEN RAISE EXCEPTION 'temporary membership remains'; END IF;
  IF EXISTS(SELECT FROM pg_roles x WHERE x.oid<>'postgres'::regrole AND x.oid<>ALL(internals) AND NOT x.rolsuper
   AND (pg_has_role(x.oid,r.roleid,'MEMBER') OR pg_has_role(x.oid,r.roleid,'SET') OR pg_has_role(x.oid,r.roleid,'USAGE'))) THEN RAISE EXCEPTION 'ordinary role path'; END IF;
 END LOOP;
 IF (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname IN ('site_private','site_api'))<>19 THEN RAISE EXCEPTION 'function inventory'; END IF;
 FOR r IN SELECT p.*,n.nspname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname IN ('site_private','site_api') LOOP
  IF (r.proconfig @> ARRAY['search_path=""']) IS DISTINCT FROM true THEN RAISE EXCEPTION 'search_path'; END IF;
  IF EXISTS(SELECT FROM aclexplode(coalesce(r.proacl,acldefault('f',r.proowner))) a
   WHERE a.grantee=0 AND a.privilege_type='EXECUTE') THEN RAISE EXCEPTION 'PUBLIC function execute'; END IF;
  expected_owner:=CASE
   WHEN r.proname='auth_source_identity' THEN 'postgres'
   WHEN r.proname='assert_site_integrity' THEN 'ecv_s3_integrity'
   WHEN r.proname IN ('business_identity','business_qualified','business_site_owned','business_site_complete','request_uid') THEN 'ecv_s3_authz_reader'
   WHEN r.proname IN ('apply_business_grant','verify_business_proof','lock_business_qualification') THEN 'ecv_s3_grant_writer'
   WHEN r.proname IN ('create_payload','create_site','read_create_operation','get_my_site','read_introduction') THEN 'ecv_s3_command_writer'
   ELSE 'ecv_s3_owner' END;
  IF r.proowner<>expected_owner::regrole THEN RAISE EXCEPTION 'function owner'; END IF;
  IF r.prosecdef IS DISTINCT FROM (r.proname IN ('assert_site_integrity','auth_source_identity','request_uid','business_identity','business_qualified',
   'business_site_owned','business_site_complete','lock_business_qualification','apply_business_grant',
   'create_site','read_create_operation','get_my_site','read_introduction')) THEN RAISE EXCEPTION 'function SECURITY'; END IF;
  FOREACH role_name IN ARRAY ARRAY['anon','authenticated','authenticator','service_role'] LOOP
   IF has_function_privilege(role_name,r.oid,'EXECUTE') IS DISTINCT FROM (role_name='authenticated' AND r.nspname='site_api') THEN
    RAISE EXCEPTION 'function execute allowlist'; END IF;
  END LOOP;
 END LOOP;
 FOREACH role_name IN ARRAY ARRAY['anon','authenticated','authenticator','service_role'] LOOP
  IF has_schema_privilege(role_name,'site_data','CREATE') OR has_schema_privilege(role_name,'site_private','CREATE') OR has_schema_privilege(role_name,'site_api','CREATE') THEN RAISE EXCEPTION 'B_ORDINARY_SCHEMA_CREATE'; END IF;
  IF has_schema_privilege(role_name,'site_data','USAGE') OR has_schema_privilege(role_name,'site_private','USAGE') THEN RAISE EXCEPTION 'private schema exposure'; END IF;
  IF has_schema_privilege(role_name,'site_api','USAGE') IS DISTINCT FROM (role_name='authenticated') THEN RAISE EXCEPTION 'API usage allowlist'; END IF;
 END LOOP;
 IF has_table_privilege('ecv_s3_integrity','site_private.business_proof_keys','SELECT')
  OR has_table_privilege('ecv_s3_command_writer','site_private.business_proof_keys','SELECT')
  OR has_table_privilege('ecv_s3_authz_reader','site_private.business_proof_keys','SELECT') THEN RAISE EXCEPTION 'key privilege'; END IF;
 IF has_any_column_privilege('ecv_s3_command_writer','site_private.user_security_state','UPDATE') THEN RAISE EXCEPTION 'command state write'; END IF;

 -- Business Schema ACLs are exact, including grantor/options and unknown
 -- grantees. Auth/extensions remain platform-managed and are checked by role.
 IF EXISTS(
  WITH expected AS (
   SELECT s.key AS schema_name,g.key AS grantee,v.privilege_type
   FROM jsonb_each(acl_contract->'schema_effective_usage_create') s
   CROSS JOIN LATERAL jsonb_each(s.value) g
   CROSS JOIN LATERAL (VALUES ('USAGE',0),('CREATE',1)) v(privilege_type,option_index)
   WHERE s.key IN ('site_data','site_private','site_api') AND (g.value->>v.option_index)::boolean
   UNION ALL SELECT 'site_api','authenticated','USAGE'
  ), actual AS (
   SELECT n.nspname::text AS schema_name,CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END AS grantee,a.privilege_type
   FROM pg_namespace n CROSS JOIN LATERAL aclexplode(coalesce(n.nspacl,acldefault('n',n.nspowner))) a
   WHERE n.nspname IN ('site_data','site_private','site_api')
  ) SELECT FROM ((SELECT * FROM expected EXCEPT SELECT * FROM actual)
    UNION ALL (SELECT * FROM actual EXCEPT SELECT * FROM expected)) mismatch
 ) THEN RAISE EXCEPTION 'B_ACL_SCHEMA_EXACT'; END IF;
 IF EXISTS(SELECT FROM pg_namespace n CROSS JOIN LATERAL aclexplode(coalesce(n.nspacl,acldefault('n',n.nspowner))) a
  WHERE n.nspname IN ('site_data','site_private','site_api') AND
   (n.nspowner<>'ecv_s3_owner'::regrole OR a.is_grantable OR a.grantor<>n.nspowner)) THEN RAISE EXCEPTION 'B_ACL_SCHEMA_OWNER_OR_GRANT_OPTION'; END IF;
 -- Exact direct ACLs; array ordering is irrelevant. Owners retain implicit
 -- administration; no non-owner grant option is allowed.
 IF EXISTS(
  WITH expected AS (
   SELECT t.key AS object_name,g.key AS grantee,v.privilege_type
   FROM jsonb_each(acl_contract->'tables') t CROSS JOIN LATERAL jsonb_each(t.value) g
   CROSS JOIN LATERAL jsonb_array_elements_text(g.value) v(privilege_type)
  ), actual AS (
   SELECT n.nspname||'.'||c.relname AS object_name,CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END AS grantee,a.privilege_type
   FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
   CROSS JOIN LATERAL aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a
   WHERE n.nspname IN ('site_data','site_private') AND c.relkind='r'
  ) SELECT FROM ((SELECT * FROM expected EXCEPT SELECT * FROM actual)
    UNION ALL (SELECT * FROM actual EXCEPT SELECT * FROM expected)) mismatch
 ) THEN RAISE EXCEPTION 'B_ACL_TABLE_EXACT'; END IF;
 IF EXISTS(
  SELECT FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
  CROSS JOIN LATERAL aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a
  WHERE n.nspname IN ('site_data','site_private') AND c.relkind='r'
   AND (a.is_grantable OR a.grantor<>c.relowner)
 ) THEN RAISE EXCEPTION 'B_ACL_TABLE_GRANT_OPTION_OR_GRANTOR'; END IF;
 IF EXISTS(
  WITH expected AS (
   SELECT x->>0 AS object_name,x->>1 AS column_name,x->>2 AS grantee,x->>3 AS privilege_type
   FROM jsonb_array_elements(acl_contract->'columns') x
  ), actual AS (
   SELECT n.nspname||'.'||c.relname AS object_name,col.attname::text AS column_name,
    CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END AS grantee,a.privilege_type
   FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_attribute col ON col.attrelid=c.oid
   CROSS JOIN LATERAL aclexplode(col.attacl) a
   WHERE n.nspname IN ('site_data','site_private') AND col.attnum>0 AND NOT col.attisdropped
  ) SELECT FROM ((SELECT * FROM expected EXCEPT SELECT * FROM actual)
    UNION ALL (SELECT * FROM actual EXCEPT SELECT * FROM expected)) mismatch
 ) THEN RAISE EXCEPTION 'B_ACL_COLUMN_EXACT'; END IF;
 IF EXISTS(
  SELECT FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_attribute col ON col.attrelid=c.oid
  CROSS JOIN LATERAL aclexplode(col.attacl) a
  WHERE n.nspname IN ('site_data','site_private') AND (a.is_grantable OR a.grantor<>c.relowner)
 ) THEN RAISE EXCEPTION 'B_ACL_COLUMN_GRANT_OPTION_OR_GRANTOR'; END IF;
 FOR spec IN SELECT t.key AS object_name,t.value AS grants FROM jsonb_each(acl_contract->'tables') t LOOP
  FOREACH role_name IN ARRAY ARRAY['ecv_s3_owner','ecv_s3_integrity','ecv_s3_authz_reader','ecv_s3_grant_writer','ecv_s3_command_writer','anon','authenticated','authenticator','service_role'] LOOP
   FOREACH privilege_name IN ARRAY ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN'] LOOP
    expected:=coalesce((spec.grants->role_name) ? privilege_name,false);
    IF has_table_privilege(role_name,spec.object_name,privilege_name) IS DISTINCT FROM expected THEN RAISE EXCEPTION 'B_ACL_EFFECTIVE_TABLE'; END IF;
    IF has_table_privilege(role_name,spec.object_name,privilege_name||' WITH GRANT OPTION') IS DISTINCT FROM (role_name='ecv_s3_owner') THEN RAISE EXCEPTION 'B_ACL_EFFECTIVE_GRANT_OPTION'; END IF;
    IF privilege_name IN ('SELECT','INSERT','UPDATE','REFERENCES') THEN
     FOR obj IN SELECT attname FROM pg_attribute WHERE attrelid=spec.object_name::regclass AND attnum>0 AND NOT attisdropped LOOP
      actual:=expected OR EXISTS(SELECT FROM jsonb_array_elements(acl_contract->'columns') x
       WHERE x->>0=spec.object_name AND x->>1=obj.attname AND x->>2=role_name AND x->>3=privilege_name);
      IF has_column_privilege(role_name,spec.object_name,obj.attname,privilege_name) IS DISTINCT FROM actual THEN RAISE EXCEPTION 'B_ACL_EFFECTIVE_COLUMN'; END IF;
      IF has_column_privilege(role_name,spec.object_name,obj.attname,privilege_name||' WITH GRANT OPTION') IS DISTINCT FROM (role_name='ecv_s3_owner') THEN RAISE EXCEPTION 'B_ACL_EFFECTIVE_COLUMN_GRANT_OPTION'; END IF;
     END LOOP;
    END IF;
   END LOOP;
  END LOOP;
 END LOOP;
 -- No direct Auth access for ANY internal business role, at table or column
 -- scope. The postgres bridge's platform privileges are not re-granted.
 FOREACH role_name IN ARRAY ARRAY['ecv_s3_owner','ecv_s3_integrity','ecv_s3_authz_reader','ecv_s3_grant_writer','ecv_s3_command_writer'] LOOP
  FOREACH privilege_name IN ARRAY ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN'] LOOP
   IF has_table_privilege(role_name,'auth.users',privilege_name) OR has_table_privilege(role_name,'auth.sessions',privilege_name) THEN RAISE EXCEPTION 'B_AUTH_DIRECT_TABLE'; END IF;
   IF privilege_name IN ('SELECT','INSERT','UPDATE','REFERENCES') AND
    (has_any_column_privilege(role_name,'auth.users',privilege_name) OR has_any_column_privilege(role_name,'auth.sessions',privilege_name)) THEN RAISE EXCEPTION 'B_AUTH_DIRECT_COLUMN'; END IF;
  END LOOP;
 END LOOP;
 FOR spec IN SELECT s.key AS schema_name,rr.key AS role_name,rr.value AS flags
  FROM jsonb_each(acl_contract->'schema_effective_usage_create') s CROSS JOIN LATERAL jsonb_each(s.value) rr LOOP
  IF spec.flags->0<>'null'::jsonb AND has_schema_privilege(spec.role_name,spec.schema_name,'USAGE') IS DISTINCT FROM (spec.flags->>0)::boolean THEN RAISE EXCEPTION 'B_ACL_SCHEMA_USAGE'; END IF;
  IF has_schema_privilege(spec.role_name,spec.schema_name,'CREATE') IS DISTINCT FROM (spec.flags->>1)::boolean THEN RAISE EXCEPTION 'B_ACL_SCHEMA_CREATE'; END IF;
  expected:=spec.role_name='ecv_s3_owner' AND spec.schema_name IN ('site_data','site_private','site_api');
  IF has_schema_privilege(spec.role_name,spec.schema_name,'USAGE WITH GRANT OPTION') IS DISTINCT FROM expected
   OR has_schema_privilege(spec.role_name,spec.schema_name,'CREATE WITH GRANT OPTION') IS DISTINCT FROM expected THEN RAISE EXCEPTION 'B_ACL_SCHEMA_GRANT_OPTION'; END IF;
 END LOOP;
 FOR spec IN SELECT key AS signature,value AS metadata FROM jsonb_each(acl_contract->'functions') LOOP
  SELECT p.*,l.lanname INTO STRICT obj FROM pg_proc p JOIN pg_language l ON l.oid=p.prolang WHERE p.oid=spec.signature::regprocedure;
  IF pg_get_userbyid(obj.proowner) IS DISTINCT FROM spec.metadata->>'owner'
   OR obj.prosecdef IS DISTINCT FROM (spec.metadata->>'security_definer')::boolean
   OR obj.lanname IS DISTINCT FROM spec.metadata->>'language'
   OR pg_get_function_result(obj.oid) IS DISTINCT FROM spec.metadata->>'returns'
   OR encode(extensions.digest(convert_to(obj.prosrc,'UTF8'),'sha256'),'hex') IS DISTINCT FROM spec.metadata->>'body_sha256'
   OR obj.proconfig IS DISTINCT FROM ARRAY['search_path=""'] THEN RAISE EXCEPTION 'B_FUNCTION_METADATA_OR_RETURN_SHAPE'; END IF;
  IF EXISTS(SELECT FROM aclexplode(coalesce(obj.proacl,acldefault('f',obj.proowner))) a
    WHERE a.privilege_type<>'EXECUTE' OR a.is_grantable OR a.grantor<>obj.proowner
     OR NOT ((spec.metadata->'execute') ? pg_get_userbyid(a.grantee)))
   OR EXISTS(SELECT FROM jsonb_array_elements_text(spec.metadata->'execute') e(role_name)
    WHERE NOT EXISTS(SELECT FROM aclexplode(coalesce(obj.proacl,acldefault('f',obj.proowner))) a WHERE a.grantee=e.role_name::regrole)) THEN RAISE EXCEPTION 'B_FUNCTION_EXECUTE_EXACT'; END IF;
  FOREACH role_name IN ARRAY ARRAY['ecv_s3_owner','ecv_s3_integrity','ecv_s3_authz_reader','ecv_s3_grant_writer','ecv_s3_command_writer','anon','authenticated','authenticator','service_role'] LOOP
   expected:=(spec.metadata->'execute') ? role_name;
   IF has_function_privilege(role_name,obj.oid,'EXECUTE') IS DISTINCT FROM expected THEN RAISE EXCEPTION 'B_FUNCTION_EFFECTIVE_EXECUTE'; END IF;
   IF has_function_privilege(role_name,obj.oid,'EXECUTE WITH GRANT OPTION') IS DISTINCT FROM (role_name=spec.metadata->>'owner') THEN RAISE EXCEPTION 'B_FUNCTION_EXECUTE_GRANT_OPTION'; END IF;
  END LOOP;
 END LOOP;
 -- All internal function creators default to self-only EXECUTE globally.
 IF EXISTS(SELECT FROM pg_default_acl d WHERE d.defaclrole=ANY(internals) AND NOT (d.defaclnamespace=0 AND d.defaclobjtype='f')) THEN RAISE EXCEPTION 'B_DEFAULT_ACL_UNEXPECTED_SCOPE'; END IF;
 IF EXISTS(SELECT FROM pg_default_acl d CROSS JOIN LATERAL aclexplode(d.defaclacl) a
  WHERE d.defaclrole=ANY(internals) AND d.defaclnamespace=0 AND d.defaclobjtype='f'
   AND (a.grantee<>d.defaclrole OR a.privilege_type<>'EXECUTE' OR a.is_grantable))
  OR (SELECT count(*) FROM pg_default_acl WHERE defaclrole=ANY(internals) AND defaclnamespace=0 AND defaclobjtype='f')<>5 THEN RAISE EXCEPTION 'B_DEFAULT_FUNCTION_ACL'; END IF;
END;
$test$;
ROLLBACK;
