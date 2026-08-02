import { describe, it, expect } from "vitest";
import { LEADER_ROLES, resolveRole, isLeader } from "./leaderRole";

// bd-2434 (NIETE port of bd-2389): the leader dashboard shows ONLY to the
// school-leader role family (mirrors the bot's LEADER_ROLES in
// bot/shared/services/observe/observe-gate.js — FIVE roles on NIETE, no
// cluster_coordinator). Teachers keep today's portal experience — so isLeader
// must be false for teachers / unknown / null.

describe("leaderRole", () => {
  it("LEADER_ROLES covers the five NIETE leader-family roles", () => {
    for (const r of ["school_leader", "aeo", "supervisor", "coach", "principal"]) {
      expect(LEADER_ROLES.has(r)).toBe(true);
    }
    expect(LEADER_ROLES.size).toBe(5);
    // upstream-only role — NOT part of the NIETE family
    expect(LEADER_ROLES.has("cluster_coordinator")).toBe(false);
  });

  it("isLeader is TRUE for every leader-family role (case/space-insensitive)", () => {
    expect(isLeader({ role: "aeo" })).toBe(true);
    expect(isLeader({ role: "coach" })).toBe(true);
    expect(isLeader({ role: "School_Leader" })).toBe(true);
    expect(isLeader({ role: " principal " })).toBe(true);
  });

  it("isLeader is FALSE for teachers, unknown roles, and missing role", () => {
    expect(isLeader({ role: "teacher" })).toBe(false);
    expect(isLeader({ role: "" })).toBe(false);
    expect(isLeader({ role: null })).toBe(false);
    expect(isLeader({})).toBe(false);
    expect(isLeader(null)).toBe(false);
    expect(isLeader(undefined)).toBe(false);
  });

  it("resolveRole normalizes to a canonical lowercase role or null", () => {
    expect(resolveRole({ role: "  AEO " })).toBe("aeo");
    expect(resolveRole({ role: "teacher" })).toBe("teacher");
    expect(resolveRole({ role: null })).toBe(null);
    expect(resolveRole(null)).toBe(null);
  });
});
