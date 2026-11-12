/*
 * OWO CRM — skrypt formularza dla stron klientów (jeden dla wszystkich firm).
 *
 *   <script src="https://<crm>/embed/v1.js" defer></script>
 *
 * Co robi:
 * 1. OWO.send(url, pola) — wysyła zgłoszenie do /api/intake/<klucz kanału>. Jeśli CRM nie odpowiada
 *    (restart, awaria, brak sieci), zapisuje zgłoszenie w przeglądarce i ponawia: co 30 s, gdy strona
 *    jest otwarta, przy powrocie sieci i przy następnej wizycie (do 7 dni). Każde zgłoszenie ma swój
 *    submission_id, więc ponowienie nie tworzy duplikatu w CRM.
 * 2. Formularze z atrybutem data-owo są obsługiwane automatycznie (bez własnego JS na stronie).
 *
 * Wynik OWO.send: {ok:true, queued:false} — przyjęte; {ok:true, queued:true} — zapisane do ponowienia;
 * błąd (Promise.reject) z polem code — zgłoszenie odrzucone przez CRM (np. consent_required), nie ponawiamy.
 */
(function (root) {
  "use strict";
  var KEY = "owo_intake_queue_v1";
  var MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
  var RETRY_MS = 30 * 1000;
  var TIMEOUT_MS = 10 * 1000;
  var storage = (function () {
    try {
      var s = root.localStorage;
      s.setItem(KEY + "_t", "1");
      s.removeItem(KEY + "_t");
      return s;
    } catch {
      return null; // tryb prywatny / zablokowane — działamy bez kolejki
    }
  })();

  function now() {
    return Date.now();
  }
  function newId() {
    if (root.crypto && root.crypto.randomUUID) return "owo-" + root.crypto.randomUUID();
    return "owo-" + now().toString(36) + "-" + Math.random().toString(36).slice(2, 12);
  }
  function readQueue() {
    if (!storage) return [];
    try {
      var list = JSON.parse(storage.getItem(KEY) || "[]");
      return Array.isArray(list) ? list : [];
    } catch {
      return [];
    }
  }
  function writeQueue(list) {
    if (!storage) return false;
    try {
      if (list.length) storage.setItem(KEY, JSON.stringify(list));
      else storage.removeItem(KEY);
      return true;
    } catch {
      return false;
    }
  }
  function isIntakeUrl(url) {
    return /\/api\/intake\/[0-9a-f-]{36}(\?|$)/i.test(String(url));
  }
  function toParams(fields) {
    var body = new root.URLSearchParams();
    if (fields && typeof fields.forEach === "function" && !Array.isArray(fields)) {
      fields.forEach(function (value, key) {
        if (typeof value === "string") body.append(key, value);
      });
    } else {
      Object.keys(fields || {}).forEach(function (key) {
        var value = fields[key];
        if (value !== undefined && value !== null) body.append(key, String(value));
      });
    }
    return body;
  }

  /** Jedna próba. Wynik: "ok" | "retry" | {rejected: kod}. */
  function attempt(item) {
    var controller = root.AbortController ? new root.AbortController() : null;
    var timer = controller
      ? root.setTimeout(function () {
          controller.abort();
        }, TIMEOUT_MS)
      : null;
    return root
      .fetch(item.url, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
          "Idempotency-Key": item.id,
        },
        body: item.body,
        signal: controller ? controller.signal : undefined,
      })
      .then(
        function (response) {
          if (response.ok) return "ok";
          // 5xx i 429 — CRM chwilowo nie przyjmuje: ponowimy. Inne 4xx — błąd danych: nie ponawiamy.
          if (response.status >= 500 || response.status === 429 || response.status === 408)
            return "retry";
          return response.json().then(
            function (payload) {
              return { rejected: (payload && payload.error) || "rejected_" + response.status };
            },
            function () {
              return { rejected: "rejected_" + response.status };
            },
          );
        },
        function () {
          return "retry"; // brak sieci, CORS przy awarii serwera, przekroczony czas
        },
      )
      .then(function (result) {
        if (timer) root.clearTimeout(timer);
        return result;
      });
  }

  var flushing = null;
  /** Ponawia zapisane zgłoszenia. Zwraca liczbę dostarczonych. */
  function flush() {
    if (flushing) return flushing;
    var list = readQueue().filter(function (item) {
      return now() - item.at < MAX_AGE_MS;
    });
    writeQueue(list);
    if (!list.length) return Promise.resolve(0);
    var delivered = 0;
    flushing = list
      .reduce(function (chain, item) {
        return chain.then(function () {
          return attempt(item).then(function (result) {
            if (result === "retry") return;
            delivered += result === "ok" ? 1 : 0;
            writeQueue(
              readQueue().filter(function (other) {
                return other.id !== item.id;
              }),
            );
          });
        });
      }, Promise.resolve())
      .then(function () {
        flushing = null;
        if (readQueue().length) schedule();
        return delivered;
      });
    return flushing;
  }

  var timerId = null;
  function schedule() {
    if (timerId) return;
    timerId = root.setTimeout(function () {
      timerId = null;
      flush();
    }, RETRY_MS);
  }

  /** Wysyła zgłoszenie; przy awarii CRM zapisuje do ponowienia. */
  function send(url, fields) {
    if (!isIntakeUrl(url))
      return Promise.reject(Object.assign(new Error("bad_url"), { code: "bad_url" }));
    var body = toParams(fields);
    var id = body.get("submission_id") || newId();
    body.set("submission_id", id);
    if (!body.get("page_url") && root.location) body.set("page_url", root.location.href);
    if (!body.get("referrer") && root.document && root.document.referrer)
      body.set("referrer", root.document.referrer);
    var item = { id: id, url: String(url), body: body.toString(), at: now() };
    return attempt(item).then(function (result) {
      if (result === "ok") return { ok: true, queued: false, id: id };
      if (result === "retry") {
        var list = readQueue();
        list.push(item);
        if (!writeQueue(list))
          return Promise.reject(Object.assign(new Error("unavailable"), { code: "unavailable" }));
        schedule();
        return { ok: true, queued: true, id: id };
      }
      return Promise.reject(Object.assign(new Error(result.rejected), { code: result.rejected }));
    });
  }

  /** Automatyczna obsługa <form data-owo action=".../api/intake/<klucz>">. */
  function bind(form) {
    if (form.__owo) return;
    form.__owo = true;
    form.addEventListener("submit", function (event) {
      event.preventDefault();
      if (typeof form.reportValidity === "function" && !form.reportValidity()) return;
      if (!form.__owoId) form.__owoId = newId(); // podwójne kliknięcie = to samo zgłoszenie
      var data = new root.FormData(form);
      data.set("submission_id", form.__owoId);
      var button = form.querySelector('[type="submit"]');
      if (button) button.disabled = true;
      send(form.action, data).then(
        function (result) {
          form.dispatchEvent(new root.CustomEvent("owo:sent", { detail: result, bubbles: true }));
          var back = data.get("return_url");
          if (back && form.getAttribute("data-owo") !== "inline") {
            root.location.href = back;
            return;
          }
          var message = root.document.createElement("p");
          message.className = "owo-success";
          message.setAttribute("role", "status");
          message.textContent =
            form.getAttribute("data-owo-success") || "Dziękujemy! Odezwiemy się wkrótce.";
          form.replaceWith(message);
        },
        function (error) {
          if (button) button.disabled = false;
          form.dispatchEvent(
            new root.CustomEvent("owo:error", { detail: { code: error.code }, bubbles: true }),
          );
          var box = form.querySelector(".owo-error");
          if (!box) {
            box = root.document.createElement("p");
            box.className = "owo-error";
            box.setAttribute("role", "alert");
            form.appendChild(box);
          }
          box.textContent =
            form.getAttribute("data-owo-error") ||
            "Nie udało się wysłać formularza. Sprawdź dane i spróbuj ponownie.";
        },
      );
    });
  }
  function bindAll() {
    var forms = root.document.querySelectorAll("form[data-owo]");
    for (var i = 0; i < forms.length; i++) bind(forms[i]);
  }

  root.OWO = {
    send: send,
    flush: flush,
    bind: bind,
    pending: function () {
      return readQueue().length;
    },
  };

  if (root.addEventListener) {
    root.addEventListener("online", function () {
      flush();
    });
  }
  if (root.document) {
    if (root.document.readyState === "loading")
      root.document.addEventListener("DOMContentLoaded", bindAll);
    else bindAll();
  }
  flush();
})(typeof window !== "undefined" ? window : this);
