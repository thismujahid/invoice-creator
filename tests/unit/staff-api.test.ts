import { afterEach, describe, expect, it, vi } from "vitest";
import { callStaff } from "../../composables/staffApi";

vi.mock("firebase/app", () => ({ getApp: () => ({}) }));
vi.mock("firebase/auth", () => ({ getAuth: () => ({ currentUser: { getIdToken: async () => "test-token" } }) }));
afterEach(() => vi.unstubAllGlobals());

describe("staff API error messages", () => {
  it("shows the server's Arabic validation message instead of a raw HTTP error", async () => {
    const message = "اسم المنتج مسجل بالفعل. افتح المنتج الموجود من زر تعديل وأضف الأنواع من داخله.";
    vi.stubGlobal("$fetch", vi.fn().mockRejectedValue({ data: { statusCode: 409, data: { code: "failed-precondition", userMessage: message } } }));
    await expect(callStaff("saveInventoryProduct", {})).rejects.toThrow(message);
  });
  it("does not expose unstructured internal errors", async () => {
    vi.stubGlobal("$fetch", vi.fn().mockRejectedValue(new Error("private stack trace")));
    await expect(callStaff("saveInventoryProduct", {})).rejects.toThrow("تعذر إتمام العملية");
  });
});
