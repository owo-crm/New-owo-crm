import { describe, expect, it } from "vitest";
import { slugify } from "@/lib/organizations/slug";
import {
  createOrganizationSchema,
  fieldErrors,
  safeNextPath,
  signInSchema,
  signUpSchema,
} from "@/lib/auth/schemas";
import { t } from "@/lib/i18n";
import { isPublicPath } from "@/lib/auth/paths";

describe("slugify", () => {
  it.each([
    ["Barowo", "barowo"],
    ["Bar Łódź & Co.", "bar-lodz-co"],
    ["  Żółć Gęślą Jaźń  ", "zolc-gesla-jazn"],
    ["Foto—Video 2027!", "foto-video-2027"],
    ["!!!", "firma"],
  ])("%s → %s", (input, expected) => {
    expect(slugify(input)).toBe(expected);
  });

  it("ограничивает длину и не оставляет дефис в конце", () => {
    const slug = slugify("a".repeat(47) + " bbbb");
    expect(slug.length).toBeLessThanOrEqual(48);
    expect(slug.endsWith("-")).toBe(false);
  });
});

describe("схемы форм", () => {
  it("вход: нормализует e-mail", () => {
    const res = signInSchema.parse({ email: "  Ivan@Barowo.COM ", password: "x" });
    expect(res.email).toBe("ivan@barowo.com");
  });

  it("регистрация: польские ошибки по каждому полю", () => {
    const res = signUpSchema.safeParse({ email: "a b", password: "krotkie" });
    expect(res.success).toBe(false);
    if (!res.success) {
      const errors = fieldErrors(res.error);
      expect(errors.email).toBe(t("auth.validation.loginInvalid"));
      expect(errors.password).toBe(t("auth.validation.passwordShort"));
      expect(errors.terms).toBe(t("auth.validation.termsRequired"));
    }
  });

  it("login: nazwa użytkownika albo e-mail", () => {
    expect(signInSchema.parse({ email: " Ivan.Barowo ", password: "x" }).email).toBe("ivan.barowo");
    expect(signInSchema.safeParse({ email: "iv", password: "x" }).success).toBe(false);
    expect(signInSchema.safeParse({ email: "ivan@barowo.com", password: "x" }).success).toBe(true);
  });

  it("регистрация: корректные данные проходят", () => {
    const res = signUpSchema.safeParse({
      fullName: "Ivan Tarasiuk",
      email: "ivan@barowo.com",
      password: "bardzo-dlugie-haslo",
      terms: "on",
    });
    expect(res.success).toBe(true);
  });

  it("фирма: имя и пресет обязательны", () => {
    expect(
      createOrganizationSchema.safeParse({ name: "B", preset: "event-services" }).success,
    ).toBe(false);
    expect(createOrganizationSchema.safeParse({ name: "Barowo", preset: "nieznany" }).success).toBe(
      false,
    );
    expect(
      createOrganizationSchema.safeParse({ name: "Barowo", preset: "event-services" }).success,
    ).toBe(true);
  });
});

describe("safeNextPath (защита от редиректа на чужой сайт)", () => {
  it.each([
    [undefined, "/dzisiaj"],
    ["/leady?x=1", "/leady?x=1"],
    ["https://evil.com", "/dzisiaj"],
    ["//evil.com", "/dzisiaj"],
    ["/\\evil.com", "/dzisiaj"],
  ])("%s → %s", (input, expected) => {
    expect(safeNextPath(input)).toBe(expected);
  });
});

describe("i18n", () => {
  it("подставляет переменные", () => {});
});

describe("публичные страницы", () => {
  it.each([
    ["/logowanie", true],
    ["/rejestracja", true],
    ["/nowe-haslo", true],
    ["/o/abc123", true],
    ["/dzisiaj", false],
    ["/leady/1", false],
    ["/logowaniex", false],
  ])("%s → %s", (path, expected) => {
    expect(isPublicPath(path)).toBe(expected);
  });
});
