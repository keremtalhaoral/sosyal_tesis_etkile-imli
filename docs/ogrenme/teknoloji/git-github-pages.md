# Git ve GitHub Pages

## 1. Tek cümlede

Git, dosyalarınızın her hâlini kaydeden dağıtık versiyon kontrol sistemidir; GitHub Pages
ise bir depodaki dosyaları **statik web sitesi** olarak ücretsiz yayınlayan servistir.

**Bu projede:** `docs/` klasörü Pages ile yayınlanıyor — ve bu tek karar, frontend
mimarisinin tamamını belirliyor.

---

## 2. Hangi problemi çözmek için doğdular

### Git (2005)

Linus Torvalds'ın derdi somuttu: Linux çekirdeği geliştiricileri kullandıkları ticari
araç BitKeeper'ın lisansını kaybetti. Mevcut açık alternatifler (CVS, Subversion) iki
şeyde zayıftı: **dallanma pahalıydı** ve **merkezî sunucu zorunluydu.**

Git'in cevabı: **her kopya tam bir depodur.** Geçmişin tamamı diskinizde; dallanma bir
işaretçi oluşturmaktan ibaret (bu yüzden anlık); sunucu bir zorunluluk değil, bir
buluşma noktası.

### GitHub Pages (2008)

Bir web sitesi yayınlamak sunucu kiralamak, alan adı ayarlamak, dosya yüklemek demekti.
Pages'in fikri: **zaten depodasınız — orayı yayınlayalım.** Push edin, site güncellensin.

Ücretsiz, HTTPS dahil, CDN üstünde. Bedeli tek bir kelimede: **statik.**

---

## 3. "Statik" tam olarak ne demek — ve bu projeyi nasıl belirledi

GitHub Pages HTML, CSS, JS ve resim **verir**. Hiçbir kod **çalıştırmaz**:

| | Pages'te var mı |
|---|---|
| HTML/CSS/JS dosyası sunmak | ✅ |
| Node.js süreci çalıştırmak | ❌ |
| PostgreSQL | ❌ |
| API anahtarı saklamak | ❌ (tarayıcıya koyarsanız herkes görür) |
| `POST` isteği işlemek | ❌ |

**Bu, projedeki çift modun tek gerçek sebebidir.**

Sayfa açılışta backend'e kısa bir yoklama atıyor. Erişilebiliyorsa (sizin makinenizde,
`npm start` açıkken) her şey gerçek backend'e gidiyor ve DBeaver'da satırlar beliriyor.
Erişilemiyorsa (yayınlanan Pages sitesi) tarayıcı-içi replika devreye giriyor ve sayfa
bunu **rozetle söylüyor**.

> ### Burada düzeltilen bir belge hatası var
>
> Proje uzun süre şunu yazıyordu: *"statik siteye gerçek backend parola hash'i asla
> gönderilmez, bu yüzden `fetch` taklit ediliyor."* **Bu gerekçe yanlıştı** —
> `/api/auth/login` zaten hash döndürmüyor, yanıtı `{ token, user }`.
>
> Gerçek sebep sıradan: **Pages sunucu çalıştıramaz.** Bir zorunluluğu var olmayan bir
> güvenlik kaygısıyla açıklamak, kararı anlamamak demektir. Belge düzeltildi.

### Alternatifler ve neden Pages'te kalındı

| Alternatif | Backend çalıştırır mı | Bu projede neden değil |
|---|---|---|
| **Vercel / Netlify** | ✅ (serverless fonksiyon) | PostgreSQL yine ayrı bir servis ister; ücretsiz katman uyku moduna geçer |
| **Render / Railway / Fly.io** | ✅ tam backend | ücretsiz katmanda uyku + soğuk başlangıç; sunum ortasında 30 sn bekleme riski |
| **Kendi VPS'iniz** | ✅ | ücret + bakım + güvenlik sorumluluğu |
| **GitHub Pages + yerel backend** | ❌ / ✅ | **seçilen**: site herkese açık kalıyor, sunum kendi makinenizde tam işlevli |

**Karar:** *"Pages kalsın, sunum yerelde."* Yayınlanan site portfolyo/erişim için,
sunum tam sürümle sizin makinenizde.

---

## 4. Bu projede tam olarak nerede

### Dal stratejisi

```
main  ← kullanıcı elle merge edene dek SABİT
  └── v_2  ← entegrasyon dalı
        ├── v2-01-veri-modeli
        ├── v2-02-auth-kripto
        ├── …
        └── v2-07-admin
```

**Granülerlik = faz.** Bir dal = anlatılabilir bir karar. Bu, git'i sadece yedekleme
aracı olmaktan çıkarıp **anlatı aracına** dönüştürüyor: her dal bir ADR'ye, her ADR bir
sunum slaytına karşılık geliyor.

### `.gitignore` — neyin git'te olmadığı, neyin olduğu kadar önemli

```
node_modules/                 türetilebilir (npm install)
data/gtfs/                    yüzlerce MB, türetilebilir
.env                          SIRLAR — asla
data/dev-credentials.json     yerel dev parolaları — asla
```

Buna karşılık **türetilmiş ama git'te olan** dosyalar da var:

```
docs/data/transit-routes.geojson   93 KB — Pages'in okuması gerekiyor
docs/data/analytics.json           anlık görüntü — çevrimdışı dashboard için
schema.sql                         türetilmiş DDL — okunabilir belge olarak değerli
```

> **Kural sezgisel değil, amaçsal:** "türetilmiş her şeyi dışla" demiyoruz. Soru şu:
> *bu dosyayı üretebilecek bir ortam her zaman var mı?* Pages'te Node yok, dolayısıyla
> `transit-routes.geojson` orada üretilemez — o yüzden commit ediliyor.

### CDN yok kuralı

Pages'in CDN'i dosyaları dağıtıyor, ama **dış** CDN kullanılmıyor. Leaflet, Turf,
Chart.js `docs/vendor/` altında (→ [09. bölüm](../09-frontend-harita.md), vendoring).
Sebep: sunum salonunda internet olmayabilir.

---

## 5. Bilinmesi gereken üç tuzak

### (a) Sırrı bir kez commit ederseniz **geçmişte kalır**

```bash
git rm --cached .env && git commit -m "sırrı kaldır"
```

Bu **yetmez.** Dosya önceki commit'lerde durmaya devam eder ve `git log -p` ile
okunabilir. Depo herkese açıksa sır **sızmış sayılır.**

Gerçek çözüm iki adımdır: (1) sırrı **iptal edip yenileyin** (rotate), (2) geçmişi
yeniden yazın (`git filter-repo`) — ki bu, dalı alan herkesi etkiler.

> Bu projede OpenWeather anahtarı hiç commit edilmedi: `.env` baştan `.gitignore`'da.
> **Ama anahtar sohbete düz metin yazıldığı için yine de açıkta sayılıyor** ve sunum
> sonrası yenilenmesi öneriliyor. Sızıntı sadece git'ten olmaz.

### (b) Pages varsayılan olarak `docs/` ya da kök klasörü yayınlar

Depo ayarlarında hangi dal ve hangi klasör olduğu seçilir. Bu projede `docs/`.
Yanlış klasör seçilirse site 404 verir ve sebebi kodda **görünmez** — ayarlar sayfasında.

### (c) Yayın anlık değil

Push'tan sonra sitenin güncellenmesi genelde bir-iki dakika sürer (bazen daha uzun).
Sunumdan beş dakika önce push edip "neden eski görünüyor?" diye paniklemek klasiktir.

Ayrıca tarayıcı önbelleği ayrı bir katman — `Ctrl+Shift+R` ile sert yenileme gerekebilir.

---

## 6. Kendin dene

```bash
# hangi dosyalar bilerek dışlanmış?
git check-ignore -v .env data/dev-credentials.json data/gtfs/ node_modules

# sırların geçmişte olmadığını doğrulayın
git log --all --oneline -- .env data/dev-credentials.json
# beklenen: boş çıktı

# depo ne kadar büyük, vendor ne kadarını kaplıyor?
du -sh .git docs/vendor docs/data

# Pages içeriğini yerelde tam olarak Pages'in gördüğü gibi görün
cd docs && python3 -m http.server 8092
```

**Çift modu kendiniz test edin.** Backend kapalıyken `http://localhost:8092` →
"○ Çevrimdışı replika". Sonra `npm start` çalıştırıp sayfayı yenileyin →
"● Canlı veritabanı". Aradaki fark, yayınlanan site ile sunum arasındaki farkın aynısı.

---

## 7. Daha fazlası için

- Git kitabı (Türkçe çevirisi var): <https://git-scm.com/book/tr/v2>
- GitHub Pages: <https://docs.github.com/pages>
- Bu kitapta: [09 — Frontend ve harita](../09-frontend-harita.md)
- Projede: `CLAUDE.md` (dal stratejisi), `.gitignore`
