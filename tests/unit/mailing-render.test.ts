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
      { organizationId: ORG, origin: "https://owocrm.com", brand: "Barowo" },
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
      { organizationId: ORG, origin: "https://owocrm.com", brand: "B" },
    );
    expect(letter.html).not.toContain("<img");
    expect(letter.html).toContain("&lt;img");
  });

  it("ответ в переписке — без отписки; тёмная тема и логотип фирмы", () => {
    const letter = renderLetter(
      {
        subject: "Oferta",
        body: "Dzień dobry",
        buttonText: "Zobacz",
        buttonUrl: "javascript:alert(1)",
      },
      { name: "Jan", email: "jan@example.com" },
      {
        organizationId: ORG,
        origin: "https://owocrm.com",
        brand: "Barowo",
        unsubscribe: false,
        look: {
          theme: "dark",
          accent: "#e8000d",
          signature: "Iwan\n+48 600 100 200",
          logoUrl: "https://crm.example.com/api/logo/x",
        },
      },
    );
    expect(letter.html).not.toContain("/wypisz?");
    expect(letter.html).toContain("#08080a"); // тёмный фон
    expect(letter.html).toContain("https://crm.example.com/api/logo/x");
    expect(letter.html).toContain("Iwan<br>+48 600 100 200");
    // кнопка с javascript: не попадает в письмо
    expect(letter.html).not.toContain("javascript:");
    expect(letter.text).toContain("Iwan");
  });

  it("токен отписки проверяется и не подделывается", () => {
    const token = unsubscribeToken(ORG, "Ewa@Example.com");
    expect(checkUnsubscribeToken(ORG, "ewa@example.com", token)).toBe(true);
    expect(checkUnsubscribeToken(ORG, "inny@example.com", token)).toBe(false);
    expect(checkUnsubscribeToken(ORG, "ewa@example.com", "nie")).toBe(false);
  });
});
