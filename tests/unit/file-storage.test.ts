import { describe, expect, it } from "vitest";
import {
  MAX_SIGNED_URL_SECONDS,
  S3Storage,
  StorageError,
  presignS3,
  s3ConfigFromEnv,
  sha256Hex,
} from "@/lib/platform/files/storage";

/** M1.7: интерфейс хранения файлов. S3 проверяется на эталоне AWS и на подменённом fetch. */

describe("подпись S3 (SigV4)", () => {
  it("совпадает с эталонным примером AWS для подписанной ссылки", () => {
    // docs.aws.amazon.com — «Authenticating Requests: Using Query Parameters», пример GET test.txt.
    const url = presignS3(
      {
        endpoint: "https://s3.amazonaws.com",
        region: "us-east-1",
        bucket: "examplebucket",
        accessKeyId: "AKIAIOSFODNN7EXAMPLE",
        secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
      },
      "GET",
      "test.txt",
      86400,
      new Date("2013-05-24T00:00:00Z"),
      {},
      true,
    );
    expect(url).toContain(
      "X-Amz-Signature=aeeed9bbccd4d02ee5c0109b86d86835f995330da4c265957d157751f604d404",
    );
    expect(url.startsWith("https://examplebucket.s3.amazonaws.com/test.txt?")).toBe(true);
  });
});

describe("S3Storage", () => {
  const cfg = {
    endpoint: "https://s3.example.test",
    region: "auto",
    bucket: "owo-files",
    accessKeyId: "KEY",
    secretAccessKey: "SECRET",
  };
  function fake() {
    const objects = new Map<string, { body: Buffer; headers: Record<string, string> }>();
    const calls: { method: string; url: string; headers: Record<string, string> }[] = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      const headers = (init?.headers ?? {}) as Record<string, string>;
      calls.push({ method, url, headers });
      const key = new URL(url).pathname;
      if (method === "PUT") {
        objects.set(key, { body: init!.body as Buffer, headers });
        return new Response(null, { status: 200 });
      }
      const obj = objects.get(key);
      if (!obj) return new Response(null, { status: 404 });
      if (method === "DELETE") {
        objects.delete(key);
        return new Response(null, { status: 204 });
      }
      const h = {
        "content-length": String(obj.body.byteLength),
        "content-type": obj.headers["content-type"],
        "x-amz-meta-sha256": obj.headers["x-amz-meta-sha256"],
      };
      return new Response(method === "HEAD" ? null : new Uint8Array(obj.body), { headers: h });
    };
    return { storage: new S3Storage({ ...cfg, fetchImpl }), calls };
  }

  it("put → head → get → delete; sha256 сохраняется и сверяется", async () => {
    const { storage, calls } = fake();
    const body = new TextEncoder().encode("umowa podpisana");
    const { sha256 } = await storage.put("org/1/umowa.pdf", body, {
      contentType: "application/pdf",
    });
    expect(sha256).toBe(sha256Hex(body));
    expect(calls[0].headers.authorization).toMatch(/^AWS4-HMAC-SHA256 Credential=KEY\//);
    expect(calls[0].headers).not.toHaveProperty("x-amz-acl"); // никаких публичных ACL
    expect(await storage.head("org/1/umowa.pdf")).toEqual({
      size: body.byteLength,
      sha256,
      contentType: "application/pdf",
    });
    expect(Buffer.from((await storage.get("org/1/umowa.pdf"))!).toString()).toBe("umowa podpisana");
    await storage.delete("org/1/umowa.pdf");
    expect(await storage.get("org/1/umowa.pdf")).toBeNull();
  });

  it("неверная контрольная сумма — отказ до загрузки", async () => {
    const { storage, calls } = fake();
    await expect(
      storage.put("x", new Uint8Array([1]), { contentType: "text/plain", sha256: "00" }),
    ).rejects.toBeInstanceOf(StorageError);
    expect(calls).toHaveLength(0);
  });

  it("подписанная ссылка живёт не дольше 5 минут и скачивается как вложение", async () => {
    const { storage } = fake();
    const url = new URL((await storage.signedUrl("a b/plik.pdf", 3600, "Umowa 7.pdf"))!);
    expect(url.searchParams.get("X-Amz-Expires")).toBe(String(MAX_SIGNED_URL_SECONDS));
    expect(url.pathname).toBe("/owo-files/a%20b/plik.pdf");
    expect(url.searchParams.get("response-content-disposition")).toContain("attachment");
  });
});

it("без переменных FILES_S3_* хранилище не подключено", () => {
  expect(s3ConfigFromEnv({})).toBeNull();
  expect(
    s3ConfigFromEnv({
      FILES_S3_ENDPOINT: "https://x.test/",
      FILES_S3_BUCKET: "b",
      FILES_S3_ACCESS_KEY_ID: "k",
      FILES_S3_SECRET_ACCESS_KEY: "s",
    }),
  ).toMatchObject({ endpoint: "https://x.test", region: "auto" });
});
