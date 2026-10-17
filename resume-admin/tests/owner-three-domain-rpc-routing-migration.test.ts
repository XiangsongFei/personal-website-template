import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(resolve("migrations/20261104000000_owner_three_domain_rpc_routing.sql"), "utf8");

describe("Owner three-domain RPC routing migration locking", () => {
  it("locks only the six affected content tables before probing target rows with NOWAIT", () => {
    const contentLock = migration.indexOf("LOCK TABLE public.resume_education_entries");
    const siteLock = migration.indexOf("ORDER BY id FOR UPDATE NOWAIT");
    const validation = migration.indexOf("Activity Log must be enabled for both targets");
    const activation = migration.indexOf("UPDATE cms_private.resume_write_modes");

    expect(contentLock).toBeGreaterThan(migration.indexOf("BEGIN;"));
    expect(siteLock).toBeGreaterThan(contentLock);
    expect(validation).toBeGreaterThan(siteLock);
    expect(activation).toBeGreaterThan(validation);
    expect(migration.match(/LOCK TABLE/g)).toHaveLength(1);
    expect(migration).toContain("resume_experience_entries");
    expect(migration).toContain("resume_intro_paragraphs");
    expect(migration).not.toContain("resume_profile");
  });

  it("rechecks both target identities after locks and changes only Owner configuration", () => {
    const siteLock = migration.indexOf("ORDER BY id FOR UPDATE NOWAIT");
    const identityRecheck = migration.indexOf("Owner/Test identity changed while acquiring activation locks");
    const firstDataCheck = migration.indexOf("Activity Log must be enabled for both targets");
    const activation = migration.indexOf("UPDATE cms_private.resume_write_modes");

    expect(siteLock).toBeLessThan(identityRecheck);
    expect(identityRecheck).toBeLessThan(firstDataCheck);
    expect(migration.slice(activation).split("UPDATE cms_private.resume_write_modes")[1]).toContain("WHERE resume_id=owner_id");
    expect(migration).toContain("Official Test configuration changed unexpectedly");
    expect(migration).toContain("BEGIN;");
    expect(migration.trimEnd().endsWith("COMMIT;")).toBe(true);
  });

  it("checks Introduction against the aggregate history contract and worst-case writer ordering bound", () => {
    expect(migration).toContain("((2147483647 - 200 - 1001)/2)");
    expect(migration).toContain("Owner Introduction snapshot is outside the Activity Log contract");
    expect(migration).toContain("cms_private.activity_event_payload_is_allowed('introduction_paragraph'");
    expect(migration).not.toContain("((2147483647 - record_count - 1001)/2)");
  });
});
