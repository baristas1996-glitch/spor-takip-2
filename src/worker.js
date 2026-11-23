
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,PUT,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type,Authorization"
};

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...corsHeaders
    }
  });

const enc = new TextEncoder();
const hex = buffer => [...new Uint8Array(buffer)].map(v => v.toString(16).padStart(2, "0")).join("");
const random = length => {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return bytes;
};
const errorText = error => error && typeof error.message === "string" ? error.message : String(error);

async function digest(value) {
  return hex(await crypto.subtle.digest("SHA-256", enc.encode(value)));
}

async function passwordHash(password, salt) {
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(password),
    "PBKDF2",
    false,
    ["deriveBits"]
  );

  const saltBytes = Uint8Array.from(
    salt.match(/.{2}/g).map(part => parseInt(part, 16))
  );

  return hex(await crypto.subtle.deriveBits({
    name: "PBKDF2",
    salt: saltBytes,
    iterations: 100000,
    hash: "SHA-256"
  }, key, 256));
}

async function body(request) {
  try { return await request.json(); } catch { return null; }
}

async function auth(request, env) {
  const token = (request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token) return null;

  const tokenHash = await digest(token);

  const row = await env.DB.prepare(
    `SELECT users.id, users.username
     FROM sessions JOIN users ON users.id = sessions.user_id
     WHERE sessions.token_hash = ? AND sessions.expires_at > ?`
  ).bind(tokenHash, Math.floor(Date.now() / 1000)).first();

  return row || null;
}

async function issueSession(env, userId) {
  const token = hex(random(32));
  const tokenHash = await digest(token);
  const expiresAt = Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 90;

  await env.DB.prepare(
    "INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(?,?,?)"
  ).bind(tokenHash, userId, expiresAt).run();

  return token;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    try {
      if (url.pathname === "/api/health" && request.method === "GET") {
        return json({ ok: true, app: "Spor Takip 2.0" });
      }

      if (url.pathname === "/api/register" && request.method === "POST") {
        const data = await body(request);

        if (!data || typeof data.username !== "string" || typeof data.password !== "string") {
          return json({ error: "Kullanıcı adı ve şifre gerekli." }, 400);
        }

        const username = data.username.trim().toLowerCase();

        if (!/^[a-z0-9._-]{3,24}$/.test(username)) {
          return json({
            error: "Kullanıcı adı 3-24 karakter olmalı; İngilizce harf, rakam, nokta, alt çizgi veya tire kullan."
          }, 400);
        }

        if (data.password.length < 8 || data.password.length > 128) {
          return json({ error: "Şifre 8-128 karakter arasında olmalı." }, 400);
        }

        const salt = hex(random(16));
        const hash = await passwordHash(data.password, salt);
        const userId = crypto.randomUUID();

        try {
          await env.DB.prepare(
            `INSERT INTO users (id, username, password_salt, password_hash, state_json)
             VALUES (?, ?, ?, ?, ?)`
          ).bind(userId, username, salt, hash, "{}").run();

        } catch (error) {
          const message = errorText(error);
          console.error("[REGISTER_USER_INSERT_ERROR]", message);

          if (/UNIQUE constraint failed/i.test(message)) {
            return json({
              error: "Bu kullanıcı adı zaten alınmış. Giriş yapmayı dene."
            }, 409);
          }

          return json({
            error: "Kullanıcı veritabanına kaydedilemedi. Cloudflare Logs kayıtlarını kontrol et."
          }, 500);
        }

        try {
          const token = await issueSession(env, userId);
          return json({ token, username });

        } catch (error) {
          console.error(
            "[REGISTER_SESSION_ERROR]",
            errorText(error),
            error && error.stack ? error.stack : ""
          );

          return json({
            error: "Hesap oluşturuldu ancak oturum açılamadı. Aynı kullanıcı adı ve şifreyle Giriş yapmayı dene."
          }, 500);
        }
      }

      if (url.pathname === "/api/login" && request.method === "POST") {
        const data = await body(request);

        if (!data || typeof data.username !== "string" || typeof data.password !== "string") {
          return json({ error: "Kullanıcı adı ve şifre gerekli." }, 400);
        }

        const username = data.username.trim().toLowerCase();

        const row = await env.DB.prepare(
          "SELECT id, username, password_salt, password_hash FROM users WHERE username = ?"
        ).bind(username).first();

        if (!row || (await passwordHash(data.password, row.password_salt)) !== row.password_hash) {
          return json({ error: "Kullanıcı adı veya şifre hatalı." }, 401);
        }

        try {
          const token = await issueSession(env, row.id);
          return json({ token, username: row.username });

        } catch (error) {
          console.error(
            "[LOGIN_SESSION_ERROR]",
            errorText(error),
            error && error.stack ? error.stack : ""
          );

          return json({
            error: "Giriş doğrulandı ancak oturum açılamadı. Cloudflare Logs kayıtlarını kontrol et."
          }, 500);
        }
      }

      if (url.pathname === "/api/state" && (request.method === "GET" || request.method === "PUT")) {
        const user = await auth(request, env);

        if (!user) {
          return json({ error: "Oturum bulunamadı. Yeniden giriş yap." }, 401);
        }

        if (request.method === "GET") {
          const row = await env.DB.prepare(
            "SELECT state_json FROM users WHERE id = ?"
          ).bind(user.id).first();

          let state = {};

          try {
            state = JSON.parse(row?.state_json || "{}");
          } catch (error) {
            console.error("[STATE_JSON_PARSE_ERROR]", errorText(error));
          }

          return json({ state, username: user.username });
        }

        const data = await body(request);

        if (!data || typeof data.state !== "object" || data.state === null || Array.isArray(data.state)) {
          return json({ error: "Geçersiz veri." }, 400);
        }

        const serialized = JSON.stringify(data.state);

        if (serialized.length > 1500000) {
          return json({ error: "Yedek çok büyük." }, 413);
        }

        await env.DB.prepare(
          "UPDATE users SET state_json = ? WHERE id = ?"
        ).bind(serialized, user.id).run();

        return json({ ok: true, savedAt: new Date().toISOString() });
      }

      if (url.pathname === "/api/logout" && request.method === "POST") {
        const token = (request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");

        if (token) {
          await env.DB.prepare(
            "DELETE FROM sessions WHERE token_hash = ?"
          ).bind(await digest(token)).run();
        }

        return json({ ok: true });
      }

      return env.ASSETS.fetch(request);

    } catch (error) {
      console.error(
        "[WORKER_UNHANDLED_ERROR]",
        url.pathname,
        errorText(error),
        error && error.stack ? error.stack : ""
      );

      return json({
        error: "Sunucu hatası. Cloudflare Logs bölümünü kontrol et."
      }, 500);
    }
  }
};
