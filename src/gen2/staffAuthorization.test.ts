import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { authorizeStaffPath, isAdminOnlyStaffPath } from "../worker";

const worker = readFileSync("src/worker.ts", "utf8");
const staffPage = readFileSync("src/gen2/StaffPage.tsx", "utf8");

describe("staff/admin authorization boundary", () => {
  it("classifies every high-authority staff mutation as administrator-only", () => {
    const adminPaths = [
      "/api/staff/campaigns/publish",
      "/api/staff/partners/organizations",
      "/api/staff/partners/organizations/00000000-0000-4000-8000-000000000001/charities",
      "/api/staff/partners/organizations/00000000-0000-4000-8000-000000000001/invitations",
      "/api/staff/partners/organizations/00000000-0000-4000-8000-000000000001/status",
      "/api/staff/partners/organizations/00000000-0000-4000-8000-000000000001/members/00000000-0000-4000-8000-000000000002/status",
      "/api/staff/finance/disbursements/prepare",
      "/api/staff/finance/disbursements/00000000-0000-4000-8000-000000000003/decision",
      "/api/staff/finance/disbursements/00000000-0000-4000-8000-000000000003/complete",
    ];
    for (const path of adminPaths) expect(isAdminOnlyStaffPath(path), path).toBe(true);
    expect(isAdminOnlyStaffPath("/api/staff/campaigns")).toBe(false);
    expect(isAdminOnlyStaffPath("/api/staff/donations/00000000-0000-4000-8000-000000000001/receipt")).toBe(false);
  });

  it("derives role from the protected database context and returns a clear 403", () => {
    expect(worker).toContain('"staff_session_context"');
    expect(worker).toContain('context.role === "staff" || context.role === "admin"');
    expect(worker).toContain('"Administrator access is required for this action."');
    expect(worker).toContain("authorizeStaffPath(staff.role, url.pathname)");
    expect(staffPage).toContain('publicApi<{ ok?: boolean; user?: { role?: string } }>("/api/staff/session")');
    expect(staffPage).toContain("canPublish={isAdmin}");
  });

  it("rejects an ordinary staff request before an admin RPC can run", async () => {
    const response = authorizeStaffPath("staff", "/api/staff/campaigns/publish");
    expect(response).not.toBeNull();
    expect(response?.status).toBe(403);
    await expect(response?.json()).resolves.toEqual({ ok: false, message: "Administrator access is required for this action." });
    expect(authorizeStaffPath("admin", "/api/staff/campaigns/publish")).toBeNull();
  });
});
