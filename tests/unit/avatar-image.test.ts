import { describe, expect, it } from "vitest";
import { avatarUrl, checkAvatar, MAX_AVATAR_BYTES } from "@/lib/avatars/image";

describe("checkAvatar", () => {
  it("узнаёт PNG, JPEG и WebP по байтам", () => {
    expect(checkAvatar(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 13, 10, 26, 10]))).toEqual({
      ok: true,
      type: "image/png",
    });
    expect(checkAvatar(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toMatchObject({
      type: "image/jpeg",
    });
    const webp = new TextEncoder().encode("RIFF\0\0\0\0WEBPVP8 ");
    expect(checkAvatar(webp)).toMatchObject({ type: "image/webp" });
  });
  it("SVG и прочее — отказ", () => {
    expect(checkAvatar(new TextEncoder().encode("<svg onload=alert(1)>"))).toEqual({
      ok: false,
      error: "type",
    });
  });
  it("пустой или слишком большой файл — отказ", () => {
    expect(checkAvatar(new Uint8Array())).toMatchObject({ error: "size" });
    expect(checkAvatar(new Uint8Array(MAX_AVATAR_BYTES + 1))).toMatchObject({ error: "size" });
  });
  it("адрес с версией, без картинки — null", () => {
    expect(avatarUrl("o", "x", 5)).toBe("/api/awatar/o/x?v=5");
    expect(avatarUrl("u", "x", null)).toBeNull();
  });
});
