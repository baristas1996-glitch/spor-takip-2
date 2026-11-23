
  if(url.pathname==="/api/register" && req.method==="POST"){
    const b=await body(req);

    if(!b || typeof b.username!=="string" || typeof b.password!=="string")
      return json({error:"Kullanıcı adı ve şifre gerekli."},400);

    const username=b.username.trim().toLowerCase();

    if(!/^[a-z0-9._-]{3,24}$/.test(username))
      return json({error:"Kullanıcı adı 3-24 karakter olmalı."},400);

    if(b.password.length<8 || b.password.length>128)
      return json({error:"Şifre en az 8 karakter olmalı."},400);

    const salt=hex(random(16));
    const hash=await passwordHash(b.password,salt);
    const id=crypto.randomUUID();

    try {
      await env.DB.prepare(
        "INSERT INTO users(id,username,password_salt,password_hash,state_json) VALUES(?,?,?,?,?)"
      ).bind(id,username,salt,hash,"{}").run();

    } catch(e) {
      console.error("REGISTER DB ERROR:",e);

      if(String(e.message).includes("UNIQUE constraint failed"))
        return json({error:"Bu kullanıcı adı zaten alınmış."},409);

      return json({error:"Veritabanına kayıt yapılamadı."},500);
    }

    try {
      const token=await issueSession(env,id);
      return json({token,username});

    } catch(e) {
      console.error("SESSION ERROR:",e);
      return json({
        error:"Hesap oluşturuldu ancak oturum açılamadı. Giriş yapmayı dene."
      },500);
    }
  }
