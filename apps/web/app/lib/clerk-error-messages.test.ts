import { describe, expect, it } from "vitest";
import { mapClerkError } from "./clerk-error-messages";

describe("mapClerkError", () => {
  it("uses the localized Clerk error when available", () => {
    const t = (key: string) =>
      key === "clerkErrors.form_identifier_exists"
        ? "Этот email уже зарегистрирован."
        : "Не удалось создать аккаунт";

    expect(mapClerkError({ code: "form_identifier_exists" }, t, "signUpFailed")).toBe(
      "Этот email уже зарегистрирован."
    );
  });

  it("uses the fallback when the translator returns an unresolved key", () => {
    const t = (key: string) => (key === "signUpFailed" ? "Не удалось создать аккаунт" : key);

    expect(mapClerkError({ code: "unknown_clerk_code" }, t, "signUpFailed")).toBe(
      "Не удалось создать аккаунт"
    );
  });
});
