import { describe, it, expect, beforeEach, vi } from "vitest";
import { createTestDb, seedTestData, wrapDbAsPool } from "./test-helpers.js";
import type Database from "better-sqlite3";

/** Add SMS-related columns and tables to the test DB. */
function addSmsSchema(db: Database.Database) {
  // SQLite can't ADD COLUMN with UNIQUE constraint; add column + index separately
  db.exec(`ALTER TABLE developers ADD COLUMN access_role TEXT DEFAULT 'engineer'`);
  db.exec(`ALTER TABLE developers ADD COLUMN phone_number TEXT`);
  db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_developers_phone ON developers(phone_number)`);

  db.exec(`CREATE TABLE IF NOT EXISTS notification_preferences (
    developer TEXT PRIMARY KEY REFERENCES developers(name),
    enabled BOOLEAN DEFAULT 0,
    digest_time TEXT DEFAULT '08:00',
    digest_days TEXT DEFAULT 'Mon,Tue,Wed,Thu,Fri',
    quiet_start TEXT,
    quiet_end TEXT,
    timezone TEXT DEFAULT 'America/New_York',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
}

describe("SMS: Identity Resolution", () => {
  let db: Database.Database;
  let pool: any;

  beforeEach(() => {
    db = createTestDb();
    seedTestData(db);
    pool = wrapDbAsPool(db);
    addSmsSchema(db);

    db.prepare(`UPDATE developers SET access_role = 'admin', phone_number = '+12025551234' WHERE name = 'alice'`).run();
    db.prepare(`UPDATE developers SET phone_number = '+12025555678' WHERE name = 'bob'`).run();
  });

  it("resolves a known phone number to developer record", async () => {
    const { resolveIdentity } = await import("../resolvers/sms.js");
    const result = await resolveIdentity(pool, "+12025551234");
    expect(result).not.toBeNull();
    expect(result.name).toBe("alice");
    expect(result.accessRole).toBe("admin");
  });

  it("returns null for unknown phone number", async () => {
    const { resolveIdentity } = await import("../resolvers/sms.js");
    const result = await resolveIdentity(pool, "+19999999999");
    expect(result).toBeNull();
  });

  it("includes time_tracking_user_id in resolved identity", async () => {
    db.prepare(`UPDATE developers SET time_tracking_user_id = 42 WHERE name = 'alice'`).run();
    const { resolveIdentity } = await import("../resolvers/sms.js");
    const result = await resolveIdentity(pool, "+12025551234");
    expect(result.timeTrackingUserId).toBe(42);
  });
});

describe("SMS: registerPhone mutation", () => {
  let db: Database.Database;
  let pool: any;
  let ctx: any;

  beforeEach(() => {
    db = createTestDb();
    seedTestData(db);
    pool = wrapDbAsPool(db);
    addSmsSchema(db);
    db.prepare(`UPDATE developers SET access_role = 'admin' WHERE name = 'alice'`).run();

    ctx = {
      db: pool,
      loaders: {},
      currentUser: { name: "alice", email: "alice@test.com", accessRole: "admin" as const },
    };
  });

  it("registers a valid E.164 phone number", async () => {
    const { smsResolvers } = await import("../resolvers/sms.js");
    const result = await smsResolvers.Mutation.registerPhone(
      null,
      { developer: "bob", phoneNumber: "+12025551234" },
      ctx
    );
    expect(result.name).toBe("bob");
    expect(result.phoneNumber).toBe("+12025551234");
  });

  it("rejects invalid phone number format", async () => {
    const { smsResolvers } = await import("../resolvers/sms.js");
    await expect(
      smsResolvers.Mutation.registerPhone(
        null,
        { developer: "bob", phoneNumber: "555-1234" },
        ctx
      )
    ).rejects.toThrow(/E\.164/);
  });

  it("rejects phone number without leading +", async () => {
    const { smsResolvers } = await import("../resolvers/sms.js");
    await expect(
      smsResolvers.Mutation.registerPhone(
        null,
        { developer: "bob", phoneNumber: "12025551234" },
        ctx
      )
    ).rejects.toThrow(/E\.164/);
  });

  it("rejects when non-admin tries to register", async () => {
    const engineerCtx = {
      ...ctx,
      currentUser: { name: "bob", email: "bob@test.com", accessRole: "engineer" as const },
    };
    const { smsResolvers } = await import("../resolvers/sms.js");
    await expect(
      smsResolvers.Mutation.registerPhone(
        null,
        { developer: "bob", phoneNumber: "+12025551234" },
        engineerCtx
      )
    ).rejects.toThrow(/[Aa]dmin/);
  });

  it("rejects duplicate phone number", async () => {
    const { smsResolvers } = await import("../resolvers/sms.js");
    await smsResolvers.Mutation.registerPhone(
      null,
      { developer: "alice", phoneNumber: "+12025559999" },
      ctx
    );
    await expect(
      smsResolvers.Mutation.registerPhone(
        null,
        { developer: "bob", phoneNumber: "+12025559999" },
        ctx
      )
    ).rejects.toThrow(/already registered/);
  });
});

describe("SMS: updateNotificationPreferences mutation", () => {
  let db: Database.Database;
  let pool: any;

  beforeEach(() => {
    db = createTestDb();
    seedTestData(db);
    pool = wrapDbAsPool(db);
    addSmsSchema(db);
    db.prepare(`UPDATE developers SET access_role = 'admin' WHERE name = 'alice'`).run();
  });

  it("admin can update any developer's notification preferences", async () => {
    const ctx = {
      db: pool,
      loaders: {},
      currentUser: { name: "alice", email: "alice@test.com", accessRole: "admin" as const },
    };
    const { smsResolvers } = await import("../resolvers/sms.js");
    const result = await smsResolvers.Mutation.updateNotificationPreferences(
      null,
      { developer: "bob", enabled: true, digestTime: "09:00", timezone: "America/Chicago" },
      ctx
    );
    expect(result.enabled).toBe(true);
    expect(result.digestTime).toBe("09:00");
    expect(result.timezone).toBe("America/Chicago");
  });

  it("engineer can update their own preferences", async () => {
    const ctx = {
      db: pool,
      loaders: {},
      currentUser: { name: "bob", email: "bob@test.com", accessRole: "engineer" as const },
    };
    const { smsResolvers } = await import("../resolvers/sms.js");
    const result = await smsResolvers.Mutation.updateNotificationPreferences(
      null,
      { developer: "bob", enabled: true },
      ctx
    );
    expect(result.enabled).toBe(true);
  });

  it("engineer cannot update another developer's preferences", async () => {
    const ctx = {
      db: pool,
      loaders: {},
      currentUser: { name: "bob", email: "bob@test.com", accessRole: "engineer" as const },
    };
    const { smsResolvers } = await import("../resolvers/sms.js");
    await expect(
      smsResolvers.Mutation.updateNotificationPreferences(
        null,
        { developer: "alice", enabled: false },
        ctx
      )
    ).rejects.toThrow(/permission/i);
  });
});

describe("SMS: sendTestSms mutation", () => {
  let db: Database.Database;
  let pool: any;

  beforeEach(() => {
    db = createTestDb();
    seedTestData(db);
    pool = wrapDbAsPool(db);
    addSmsSchema(db);
    db.prepare(
      `UPDATE developers SET access_role = 'admin', phone_number = '+12025551234' WHERE name = 'alice'`
    ).run();
  });

  it("rejects when non-admin tries to send test SMS", async () => {
    const ctx = {
      db: pool,
      loaders: {},
      currentUser: { name: "bob", email: "bob@test.com", accessRole: "engineer" as const },
    };
    const { smsResolvers } = await import("../resolvers/sms.js");
    await expect(
      smsResolvers.Mutation.sendTestSms(null, { developer: "alice" }, ctx)
    ).rejects.toThrow(/[Aa]dmin/);
  });

  it("rejects when developer has no phone number", async () => {
    const ctx = {
      db: pool,
      loaders: {},
      currentUser: { name: "alice", email: "alice@test.com", accessRole: "admin" as const },
    };
    const { smsResolvers } = await import("../resolvers/sms.js");
    await expect(
      smsResolvers.Mutation.sendTestSms(null, { developer: "bob" }, ctx)
    ).rejects.toThrow(/phone number/i);
  });
});

describe("SMS: mapDeveloper includes SMS fields", () => {
  it("includes phoneNumber and accessRole in mapped output", async () => {
    const { mapDeveloper } = await import("../resolvers/mappers.js");
    const row = {
      name: "alice",
      full_name: "Alice Smith",
      role: "fullstack",
      access_role: "admin",
      phone_number: "+12025551234",
      baseline_competency: null,
      strengths: null,
      growth_areas: null,
    };
    const result = mapDeveloper(row);
    expect(result.phoneNumber).toBe("+12025551234");
    expect(result.accessRole).toBe("admin");
  });

  it("defaults accessRole when not present in row", async () => {
    const { mapDeveloper } = await import("../resolvers/mappers.js");
    const row = {
      name: "bob",
      full_name: "Bob Jones",
      role: "frontend",
      baseline_competency: null,
      strengths: null,
      growth_areas: null,
    };
    const result = mapDeveloper(row);
    expect(result.accessRole).toBe("engineer");
    expect(result.phoneNumber).toBeNull();
  });
});

describe("SMS: Twilio service", () => {
  it("sendSms function exists and validates inputs", async () => {
    const { sendSms } = await import("../services/twilio-api.js");
    await expect(sendSms("+12025551234", "Test message")).rejects.toThrow();
  });

  it("validates E.164 phone number format", async () => {
    const { sendSms } = await import("../services/twilio-api.js");
    await expect(sendSms("not-a-number", "Test")).rejects.toThrow(/E\.164/);
  });
});
