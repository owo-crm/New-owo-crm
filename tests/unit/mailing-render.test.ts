import { describe, expect, it } from "vitest";
import { fillName, renderLetter } from "@/lib/mailing/render";
import { checkUnsubscribeToken, unsubscribeToken } from "@/lib/mailing/unsubscribe";

process.env.MAIL_SECRET_KEY ??= Buffer.alloc(32).toString("base64");

const ORG = "11111111-1111-4111-8111-111111111111";

describe("письмо рассылки", () => {
  it("{imie} превращается в имя, фамилия отбрасывается", () => {
    expect(fillName("Cześć {imie}!", "Anna Kowalska")).toBe("Cześć Anna!");
    expect(fillName("Cześć {imie}!", "  ")).toBe("Cześć !");
  });

  it("в письме всегда есть ссылка отписки и нет чужих скриптов", () => {
    const letter = renderLetter(
      { subject: "Wolne terminy", body: "Cześć {imie}\n\nMamy wolne soboty." },
      { name: "Ewa Zielińska", email: "ewa@example.com" },
      { organizationId: ORG, origin: "https://owocrm.com", brand: "Barowo", brandColor: "#e8000d" },
    );
    expect(letter.subject).toBe("Wolne terminy");
    expect(letter.html).toContain("Cześć Ewa");
    expect(letter.html).toContain("/wypisz?");
    expect(letter.html).not.toContain("<script");
    // Текстовая часть нужна, иначе письмо чаще уходит в спам.
    expect(letter.text).toContain("Wypisz się");
  });

  it("опасные символы в тексте экранируются", () => {
    const letter = renderLetter(
      { subject: "x", body: '<img src=x onerror="alert(1)">' },
      { name: "Jan", email: "jan@example.com" },
      { organizationId: ORG, origin: "https://owocrm.com", brand: "B", brandColor: "#000000" },
    );
    expect(letter.html).not.toContain("<img");
    expect(letter.html).toContain("&lt;img");
  });

  it("токен отписки проверяется и не подделывается", () => {
    const token = unsubscribeToken(ORG, "Ewa@Example.com");
    expect(checkUnsubscribeToken(ORG, "ewa@example.com", token)).toBe(true);
    expect(checkUnsubscribeToken(ORG, "inny@example.com", token)).toBe(false);
    expect(checkUnsubscribeToken(ORG, "ewa@example.com", "nie")).toBe(false);
  });
});
