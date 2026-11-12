import { MAILING_PANEL_HTML } from "./mailing-panel.js";
const LEAD_PREFIX = "/lead";

function buildCorsHeaders(request) {
  const origin = request.headers.get("origin") || "*";
  return {
    "access-control-allow-origin": origin,
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "access-control-allow-headers": "content-type",
    "access-control-max-age": "86400",
    vary: "Origin"
  };
}

function withCors(response, request) {
  const headers = new Headers(response.headers);
  const corsHeaders = buildCorsHeaders(request);

  Object.keys(corsHeaders).forEach((key) => {
    headers.set(key, corsHeaders[key]);
  });

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}

function jsonResponse(body, init = {}, request = null) {
  const response = new Response(JSON.stringify(body), {
    status: init.status || 200,
    headers: {
      "content-type": "application/json; charset=utf-8"
    }
  });

  return request ? withCors(response, request) : response;
}

function isSecretValid(request, env) {
  if (!env.TELEGRAM_WEBHOOK_SECRET) {
    return true;
  }

  return request.headers.get("x-telegram-bot-api-secret-token") === env.TELEGRAM_WEBHOOK_SECRET;
}

function getAppsScriptBaseUrl(env) {
  if (!env.APPS_SCRIPT_WEBHOOK_URL) {
    throw new Error("Missing APPS_SCRIPT_WEBHOOK_URL");
  }

  return env.APPS_SCRIPT_WEBHOOK_URL;
}

function buildAppsScriptUrl(env, params) {
  const url = new URL(getAppsScriptBaseUrl(env));

  Object.entries(params || {}).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") {
      url.searchParams.set(key, String(value));
    }
  });

  return url.toString();
}

async function callAppsScriptJson(url, init = {}) {
  const response = await fetch(url, {
    method: init.method || "GET",
    headers: init.headers || {},
    body: init.body,
    redirect: "follow"
  });

  const responseText = await response.text();
  let json;

  try {
    json = JSON.parse(responseText);
  } catch (error) {
    throw new Error("Apps Script returned non-JSON response");
  }

  return {
    status: response.status,
    json
  };
}

async function callAppsScriptText(url, init = {}) {
  const response = await fetch(url, {
    method: init.method || "GET",
    headers: init.headers || {},
    body: init.body,
    signal: init.signal,
    redirect: "follow"
  });

  return {
    status: response.status,
    text: await response.text()
  };
}

async function forwardTelegramUpdateToAppsScript(update, env) {
  const form = new URLSearchParams();
  form.set("telegram_payload", JSON.stringify(update));
  form.set("relay_token", env.APPS_SCRIPT_RELAY_SECRET || "");

  const response = await callAppsScriptJson(getAppsScriptBaseUrl(env), {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded;charset=UTF-8"
    },
    body: form.toString()
  });

  if (response.status !== 200) {
    throw new Error("Apps Script forward failed: " + response.status);
  }

  if (!response.json || response.json.ok !== true) {
    throw new Error("Apps Script handler rejected update");
  }
}

function buildLeadRelayHtml(message, backUrl) {
  return "<!doctype html>" +
    "<html lang=\"pl\"><head>" +
    "<meta charset=\"utf-8\">" +
    "<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">" +
    "<title>BAROWO</title>" +
    "<style>body{font-family:Arial,sans-serif;padding:24px;background:#06061a;color:#fff}a{color:#fff}</style>" +
    "</head><body>" +
    "<h1>BAROWO</h1>" +
    "<p>" + message + "</p>" +
    "<p><a href=\"" + backUrl + "\">Wróć do formularza</a></p>" +
    "</body></html>";
}

async function handleLeadRequest(request, env, url, ctx) {
  if (request.method === "OPTIONS") {
    return withCors(new Response(null, { status: 204 }), request);
  }

  if (request.method === "GET") {
    let upstreamStatus = 0;
    let upstreamHealthy = false;

    try {
      const upstream = await callAppsScriptText(getAppsScriptBaseUrl(env), {
        method: "GET"
      });
      upstreamStatus = upstream.status;
      upstreamHealthy = upstream.status >= 200 &&
        upstream.status < 400 &&
        upstream.text.includes("barowo-crm-gas");
    } catch (error) {
      upstreamStatus = 0;
      upstreamHealthy = false;
    }

    return jsonResponse({
      ok: true,
      service: "barowo-lead-relay",
      upstreamConfigured: !!env.APPS_SCRIPT_WEBHOOK_URL,
      upstreamHealthy,
      upstreamStatus
    }, {}, request);
  }

  if (request.method !== "POST") {
    return jsonResponse({ ok: false, error: "Method Not Allowed" }, { status: 405 }, request);
  }

  const formData = await request.formData();
  const params = new URLSearchParams();
  let returnUrl = "https://barowo.com/#contact";

  formData.forEach((value, key) => {
    if (typeof value === "string") {
      params.set(key, value);
      if (key === "return_url" && value) {
        returnUrl = value;
      }
    }
  });

  params.set("response", "json");
  // One id per submission: a retry from the queue never creates a second lead in the CRM.
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(params.get("submission_id") || "")) {
    params.set("submission_id", crypto.randomUUID().replace(/-/g, ""));
  }

  const wantsJson = url.searchParams.get("format") === "json" ||
    (request.headers.get("accept") || "").includes("application/json");

  let outcome;
  try {
    outcome = await forwardLeadToAppsScript(params, env);
  } catch (error) {
    outcome = { ok: false, outage: true, reason: error.message };
  }

  let responseBody;
  if (outcome.ok) {
    responseBody = { ok: true, status: outcome.status, uid: outcome.uid, redirect_url: returnUrl };
  } else if (outcome.outage && isQueueableLead(params)) {
    // The CRM did not confirm the lead: keep it safe instead of losing it.
    const saved = await saveLeadForRetry(params, env, outcome.reason, ctx);
    if (!saved) throw new Error("lead_forward_failed");
    responseBody = { ok: true, status: "queued", uid: "", redirect_url: returnUrl };
  } else {
    throw new Error(outcome.reason || "lead_forward_failed");
  }

  if (wantsJson) {
    return jsonResponse(responseBody, {}, request);
  }

  return withCors(Response.redirect(responseBody.redirect_url, 302), request);
}

// Returns {ok, status, uid} when the CRM confirmed the lead; {ok:false, outage} when it
// did not answer properly (timeout, HTTP error, broken reply); {ok:false} for a rejected form.
async function forwardLeadToAppsScript(params, env) {
  const upstream = await callAppsScriptText(getAppsScriptBaseUrl(env), {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded;charset=UTF-8"
    },
    body: params.toString(),
    signal: AbortSignal.timeout(25000)
  });
  let payload;
  try { payload = JSON.parse(upstream.text); } catch (error) { payload = null; }
  if (upstream.status < 200 || upstream.status >= 300 || !payload) return { ok: false, outage: true, reason: "lead_forward_failed" };
  if (payload.ok !== true) {
    const rejected = payload.error === "validation_failed" || !payload.error;
    return { ok: false, outage: !rejected, reason: rejected ? "lead_rejected" : "lead_forward_failed" };
  }
  const status = payload.status;
  if (!["created", "merged", "spam"].includes(status)) return { ok: false, reason: "lead_unconfirmed" };
  const validUid = status === "created" ? /^[a-f0-9]{8}$/i.test(payload.uid || "") : /^[a-zA-Z0-9_-]{1,80}$/.test(payload.uid || "");
  if (status !== "spam" && !validUid) return { ok: false, reason: "lead_id_missing" };
  return { ok: true, status, uid: status === "spam" ? "" : payload.uid };
}

function isQueueableLead(params) {
  if ((params.get("company") || "").trim()) return false; // honeypot
  const hasContact = (params.get("email") || "").trim() || (params.get("phone") || "").trim();
  return !!((params.get("name") || "").trim() && hasContact && params.get("privacy_consent"));
}

function escapeTelegramHtml(value) {
  return String(value || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function buildFallbackLeadText(params) {
  const field = (key) => escapeTelegramHtml((params.get(key) || "").trim().slice(0, 400));
  const lines = [
    "🚨 <b>Zgłoszenie awaryjne ze strony</b>",
    "<i>CRM nie odpowiedział. Zgłoszenie jest zapisane — dodam je do CRM automatycznie, gdy CRM wróci.</i>",
    "",
    "👤 <b>" + field("name") + "</b>"
  ];
  if (params.get("phone")) lines.push("📞 " + field("phone"));
  if (params.get("email")) lines.push("✉️ " + field("email"));
  const event = [field("event_type"), field("event_date"), field("city"), field("guests")].filter(Boolean).join(" · ");
  if (event) lines.push("🎉 " + event);
  if (params.get("message")) lines.push("🗒 " + field("message"));
  lines.push("", "ID: <code>" + field("submission_id") + "</code>");
  return lines.join("\n");
}

async function sendTelegramMessage(env, text, replyTo) {
  if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_GROUP_CHAT_ID) return null;
  const body = { chat_id: env.TELEGRAM_GROUP_CHAT_ID, text, parse_mode: "HTML", link_preview_options: { is_disabled: true } };
  if (replyTo) body.reply_parameters = { message_id: replyTo, allow_sending_without_reply: true };
  const response = await fetch("https://api.telegram.org/bot" + env.TELEGRAM_BOT_TOKEN + "/sendMessage", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10000)
  });
  const json = await response.json().catch(() => null);
  return json && json.ok && json.result ? json.result.message_id : null;
}

// KV keeps the lead for 7 days; the cron below retries every 5 minutes.
async function saveLeadForRetry(params, env, reason, ctx) {
  const id = params.get("submission_id");
  let telegramId = null;
  try { telegramId = await sendTelegramMessage(env, buildFallbackLeadText(params)); } catch (error) {
    console.error("fallback_telegram_failed", { message: error.message });
  }
  let stored = false;
  if (env.LEAD_QUEUE) {
    try {
      await env.LEAD_QUEUE.put("lead:" + id, JSON.stringify({
        params: params.toString(), createdAt: Date.now(), attempts: 0, telegramId, reason: reason || ""
      }), { expirationTtl: 7 * 24 * 60 * 60 });
      stored = true;
    } catch (error) {
      console.error("lead_queue_put_failed", { message: error.message });
    }
  }
  console.error("lead_saved_for_retry", { id, stored, telegram: !!telegramId, reason });
  return stored || !!telegramId;
}

async function retryQueuedLeads(env) {
  if (!env.LEAD_QUEUE) return { retried: 0 };
  const list = await env.LEAD_QUEUE.list({ prefix: "lead:" });
  let added = 0;
  for (const key of list.keys) {
    const raw = await env.LEAD_QUEUE.get(key.name);
    if (!raw) continue;
    let item;
    try { item = JSON.parse(raw); } catch (error) { await env.LEAD_QUEUE.delete(key.name); continue; }
    const params = new URLSearchParams(item.params);
    let outcome;
    try { outcome = await forwardLeadToAppsScript(params, env); } catch (error) { outcome = { ok: false, outage: true, reason: error.message }; }
    if (outcome.ok || !outcome.outage) {
      await env.LEAD_QUEUE.delete(key.name);
      const name = escapeTelegramHtml(params.get("name") || "");
      await sendTelegramMessage(env, outcome.ok
        ? "✅ Zgłoszenie awaryjne <b>" + name + "</b> jest już w CRM — karta w grupie."
        : "⚠️ CRM odrzucił zgłoszenie awaryjne <b>" + name + "</b> (" + escapeTelegramHtml(outcome.reason) + "). Dodaj je ręcznie: /nowylead", item.telegramId).catch(() => null);
      if (outcome.ok) added++;
      continue;
    }
    item.attempts = (item.attempts || 0) + 1;
    if (item.attempts === 12) {
      await sendTelegramMessage(env, "⚠️ Od godziny nie mogę dodać zgłoszenia <b>" + escapeTelegramHtml(params.get("name") || "") +
        "</b> do CRM. Próbuję dalej — w razie potrzeby dodaj je ręcznie: /nowylead", item.telegramId).catch(() => null);
    }
    await env.LEAD_QUEUE.put(key.name, JSON.stringify(item), { expirationTtl: 7 * 24 * 60 * 60 });
  }
  return { retried: list.keys.length, added };
}

// ─── Mailing panel API: the CRM checks the token on every call ───────────────

async function handleMailingApi(request, env) {
  const json = (body, status) => new Response(JSON.stringify(body), { status: status || 200,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
  let form;
  try { form = await request.formData(); } catch (error) { return json({ ok: false, error: "bad_request" }, 400); }
  const token = String(form.get("token") || "");
  if (!/^[a-f0-9]{48}$/.test(token)) return json({ ok: false, error: "expired" });
  const body = new URLSearchParams({ mailing_api: "1", token, op: String(form.get("op") || ""), payload: String(form.get("payload") || "{}").slice(0, 60000) });
  try {
    const upstream = await callAppsScriptText(getAppsScriptBaseUrl(env), {
      method: "POST", headers: { "content-type": "application/x-www-form-urlencoded;charset=UTF-8" },
      body: body.toString(), signal: AbortSignal.timeout(50000)
    });
    const payload = JSON.parse(upstream.text);
    return json(payload);
  } catch (error) {
    console.error("mailing_api_failed", { message: error.message });
    return json({ ok: false, error: "CRM nie odpowiada — spróbuj za chwilę." }, 502);
  }
}

// ─── Unsubscribe page for CRM mailings: /wypisz?e=…&t=… ──────────────────────

function unsubscribePage(title, text) {
  return new Response("<!doctype html><html lang=\"pl\"><head><meta charset=\"utf-8\">" +
    "<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\"><meta name=\"robots\" content=\"noindex\">" +
    "<title>BAROWO — " + title + "</title><style>body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;" +
    "background:#06061a;color:#e8ebfa;font:16px/1.6 Arial,Helvetica,sans-serif;padding:24px;box-sizing:border-box}" +
    "main{max-width:460px;border-top:4px solid #e8000d;padding-top:24px}h1{font-size:26px;margin:0 0 12px;letter-spacing:.02em}" +
    "a{color:#fff}</style></head><body><main><h1>" + title + "</h1><p>" + text + "</p><p><a href=\"https://barowo.com/\">barowo.com</a></p></main></body></html>",
    { status: 200, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
}

async function handleUnsubscribe(url, env) {
  const e = url.searchParams.get("e") || "", t = url.searchParams.get("t") || "";
  if (!e || !t) return unsubscribePage("Nieprawidłowy link", "Ten link do wypisania jest niekompletny. Napisz do nas: barowo.pl@gmail.com.");
  try {
    const target = buildAppsScriptUrl(env, { action: "unsubscribe", e, t });
    const upstream = await callAppsScriptText(target, { method: "GET", signal: AbortSignal.timeout(20000) });
    const payload = JSON.parse(upstream.text);
    if (payload && payload.unsubscribed) {
      return unsubscribePage("Wypisano", "Nie będziemy już wysyłać Ci wiadomości z ofertami BAROWO. Odpowiedzi na Twoje zapytania nadal będą przychodzić.");
    }
  } catch (error) {
    console.error("unsubscribe_failed", { message: error.message });
    return unsubscribePage("Spróbuj ponownie", "Nie udało się teraz zapisać wypisania. Spróbuj za kilka minut albo napisz: barowo.pl@gmail.com.");
  }
  return unsubscribePage("Nieprawidłowy link", "Ten link do wypisania jest nieaktualny. Napisz do nas: barowo.pl@gmail.com, a usuniemy adres ręcznie.");
}

export { retryQueuedLeads, forwardLeadToAppsScript };

export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(retryQueuedLeads(env).catch((error) => console.error("lead_retry_failed", { message: error.message })));
  },

  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === "/wypisz" && request.method === "GET") {
      return handleUnsubscribe(url, env);
    }

    if (url.pathname === "/mailing" && request.method === "GET") {
      return new Response(MAILING_PANEL_HTML, { headers: {
        "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-robots-tag": "noindex",
        "referrer-policy": "no-referrer", "x-frame-options": "DENY" } });
    }

    if (url.pathname === "/mailing/api" && request.method === "POST") {
      return handleMailingApi(request, env);
    }

    if (url.pathname === LEAD_PREFIX) {
      try {
        return await handleLeadRequest(request, env, url, ctx);
      } catch (error) {
        console.error("lead_request_failed", {
          message: error.message,
          path: url.pathname
        });
        return jsonResponse({ ok: false, error: "Lead relay unavailable" }, { status: 502 }, request);
      }
    }

    if (request.method === "GET") {
      return jsonResponse({
        ok: true,
        service: "barowo-telegram-relay",
        path: url.pathname
      });
    }

    if (request.method !== "POST") {
      return jsonResponse({ ok: false, error: "Method Not Allowed" }, { status: 405 });
    }

    if (!isSecretValid(request, env)) {
      return jsonResponse({ ok: false, error: "Forbidden" }, { status: 403 });
    }

    let update;
    try {
      update = await request.json();
    } catch (error) {
      return jsonResponse({ ok: false, error: "Invalid JSON" }, { status: 400 });
    }

    ctx.waitUntil(
      forwardTelegramUpdateToAppsScript(update, env).catch((error) => {
        console.error("forward_to_apps_script_failed", {
          message: error.message,
          updateId: update && typeof update.update_id === "number" ? update.update_id : null
        });
      })
    );

    return jsonResponse({ ok: true, accepted: true });
  }
};
