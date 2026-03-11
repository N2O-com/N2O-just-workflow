import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

describe("validateDbConfig", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("throws when SUPABASE_REF is missing", async () => {
    delete process.env.SUPABASE_REF;
    process.env.SUPABASE_ACCESS_TOKEN = "test-token";

    const { validateDbConfig } = await import("../db.js");
    expect(() => validateDbConfig()).toThrow("SUPABASE_REF");
  });

  it("throws when SUPABASE_ACCESS_TOKEN is missing", async () => {
    process.env.SUPABASE_REF = "test-ref";
    delete process.env.SUPABASE_ACCESS_TOKEN;

    const { validateDbConfig } = await import("../db.js");
    expect(() => validateDbConfig()).toThrow("SUPABASE_ACCESS_TOKEN");
  });

  it("does not throw when both env vars are set", async () => {
    process.env.SUPABASE_REF = "test-ref";
    process.env.SUPABASE_ACCESS_TOKEN = "test-token";

    const { validateDbConfig } = await import("../db.js");
    expect(() => validateDbConfig()).not.toThrow();
  });
});
