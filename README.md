# Spor Takip 2.0

Mobil uyumlu antrenman günlüğü: set başına ayrı tekrar/kilo, programlar, antrenman geçmişi, vücut ağırlığı ve gelişim ekranı. Cloudflare Worker + D1 veritabanı kullanır. Uygulama yerel önbelleğe de kaydeder; bulut hesabı ile farklı cihazlarda eşitlenir.

## Özellikler
- Her hareket için set ekleme; her sette bağımsız tekrar, kg ve tamamlandı işareti.
- Hazır hareket kütüphanesi ve özel hareket ekleme.
- Antrenman başlatma, kaydetme, geçmişi görüntüleme ve silme.
- Ayrı bir **Programlarım** sayfası: program adıyla program oluşturma, hareket/set/tekrar/başlangıç kilosu tanımlama, programları listeleme ve silme.
- Antrenman sayfasında kayıtlı programı açılır listeden adına göre seçip tek dokunuşla antrenmana yükleme.
- Antrenman sırasında mevcut çalışmayı program olarak kaydetme; kayıtlı programı tekrar tekrar kullanma.
- Vücut ağırlığı kayıtları ve trend grafiği.
- Hareket bazında kaydedilmiş en yüksek kilo ve antrenman hacmi.
- Kullanıcı adı/şifre ile bulut hesabı; oturum açınca D1'e eşitleme.
- PWA manifest ve çevrimdışı statik dosya önbelleği.

## Cloudflare kurulumu (iPhone ile)

### 1. D1 veritabanı oluştur
1. Cloudflare Dashboard > **Storage & databases** > **D1 SQL Database** bölümüne gir.
2. **Create database** seç.
3. Adını `spor-takip-2-db` yap ve oluştur.
4. Oluşan veritabanının **Database ID** değerini kopyala.

### 2. Wrangler yapılandırmasına Database ID ekle
1. GitHub'da yeni `spor-takip-2` deposunun ana dizininde `wrangler.jsonc` dosyasını aç ve kalem simgesine bas.
2. `database_id` satırındaki `REPLACE_WITH_YOUR_D1_DATABASE_ID` metnini az önce kopyaladığın gerçek ID ile değiştir.
3. Kaydet / Commit changes.

`database_name` `spor-takip-2-db`, `binding` `DB` olarak kalmalı.

### 3. İlk dağıtım komutu
Cloudflare Workers Builds ayarlarında Deploy command alanına aşağıdaki komutu gir:

```sh
npx wrangler d1 execute spor-takip-2-db --remote --file=./migrations/0001_init.sql && npx wrangler deploy
```

Build command boş kalabilir. Root directory `/` olmalı. İlk dağıtımdan sonra GitHub'a gönderilen her yeni commit aynı dağıtım komutunu çalıştırabilir; SQL dosyası `IF NOT EXISTS` kullandığı için tekrar çalıştırılması güvenlidir.

### 4. Test
Dağıtım tamamlanınca Worker URL'sini aç. Sağ üstteki hesap simgesinden kullanıcı adı ve en az 8 karakterli şifre ile hesap oluştur. Daha sonra başka cihazda aynı hesapla giriş yapıp bulut verilerini eşitleyebilirsin.

## Önemli notlar
- Şifreyi güvenli bir yere kaydet. Bu ilk sürümde şifre sıfırlama akışı yoktur.
- Bulut hesabı olmadan veriler yalnızca o tarayıcının yerel depolamasında kalır.
- Hesap oluşturma ve giriş D1 gerektirir; önce D1 veritabanını oluşturup ID'yi eklemeden dağıtım yapma.
- `public/` statik web uygulamasıdır; `src/worker.js` API ve kimlik doğrulama uçlarını sağlar.
- Bu proje önceki `spor-takip-yeni` Worker'ından ayrı `spor-takip-2` adıyla yapılandırılmıştır.
