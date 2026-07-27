# 10 — Veri nereden geliyor?

> Son teknik bölüm. Şu ana kadar hep "veri" dedik ama hiç sormadık: **bu veri kim
> tarafından, nasıl üretildi ve ne kadarına güvenebiliriz?**

---

## 1. Bir cümlede

Bu projedeki veri dört farklı kaynaktan gelir ve her birinin **güvenilirliği farklıdır**;
önemli olan hangisinin ne olduğunu bilmek ve bunu **saklamamaktır**.

---

## 2. Benzetme: gazete haberi

İyi bir gazeteci her cümlenin kaynağını bilir: *"bakanlık açıkladı"*, *"görgü tanığı
söyledi"*, *"muhabirimizin tahmini"*. Üçü de habere girer ama **hiçbiri diğerinin yerine
geçmez** ve okuyucu hangisinin ne olduğunu görür.

Bu proje de aynı disiplini izliyor: haritadaki her çizginin, her sıcaklık değerinin
nereden geldiği kayıtlı.

**Benzetme nerede bozuluyor:** Gazetede yanlış kaynak sadece itibar kaybettirir. Yazılımda
**sessizce yanlış cevap** verdirir. Bir "tahmin"i "ölçüm" gibi göstermek, o veriyi kullanan
her kararı bozar — ve kimse fark etmez. Bu yüzden projedeki kural şu:
**uydurma veri, gerçek veri gibi görünmemeli.**

---

## 3. Dört kaynak

| Kaynak | Ne veriyor | Güven düzeyi | Nerede |
|---|---|---|---|
| **`data/seed.json`** | 30 tesis, menü, kullanıcılar | **kanonik** — projenin gerçeği bu | git'te |
| **İBB Açık Veri / GTFS** | toplu taşıma güzergahları | **kalite kapılı** gerçek veri | türetilmiş çıktı git'te |
| **OpenWeather API** | anlık hava durumu | **canlı ölçüm** (anahtar varsa) | çalışma anında |
| **`scripts/generate-data.js`** | 425 bin rezervasyon | **açıkça sentetik** — ölçek testi için | git'te değil, üretilir |

Bu ayrım kritik: **`seed.json` türetilmiş değildir, veritabanı türetilmiştir.** Veritabanını
silip `npm start` derseniz seed'den yeniden kurulur. Yani "gerçek kaynak" (source of truth)
git'teki JSON dosyasıdır, PostgreSQL değil.

---

## 4. GTFS: toplu taşıma verisinin ortak dili

**GTFS** (General Transit Feed Specification), Google'ın 2006'da Portland'daki bir toplu
taşıma idaresiyle birlikte geliştirdiği açık formattır. Bugün dünyada binlerce operatör
sefer verisini bu formatta yayınlar — İBB dahil.

GTFS aslında bir **ZIP içindeki CSV dosyaları** kümesidir:

```
routes.txt      → hatlar         (34, M2, T1 …)
trips.txt       → seferler       (bir hattın belirli bir yöndeki tek gidişi)
stops.txt       → duraklar       (koordinatlarıyla)
stop_times.txt  → hangi sefer hangi durağa saat kaçta uğruyor
shapes.txt      → hattın gerçek çizgisi (koordinat dizisi)
```

**Neden `shapes.txt` kritik?** Durakları düz çizgiyle birleştirirseniz metro hattı
binaların içinden geçer, otobüs denizden geçer. `shapes.txt` aracın gerçekten izlediği
yolu verir — bu projedeki güzergah çizgileri oradan geliyor.

### Kalite kapısı — projenin en dürüst kararı

Sorun şu: `seed.json`'daki tesisler *"34 Metrobüs ile ulaşılır"* diyor, ama GTFS'te hat
kodları farklı yazılmış olabilir. Bir hat adını yanlış eşleştirirsek **haritada uydurma
bir çizgi** belirir ve kimse anlamaz.

`scripts/build-routes.js` bunu iki eşikle engelliyor:

```js
const COV_MIN  = 0.6;   // hattın duraklarının en az %60'ı shape'e oturmalı
const DIST_MAX = 350;   // durakların shape'e ortalama uzaklığı en fazla 350 m
```

Eşikleri geçemeyen eşleşme **çizilmez** — ve sessizce atılmaz, sebebiyle birlikte
çıktıya yazılır:

```json
"low-confidence(cov=0.42,dist=890m)"
```

### Sonuç — sayılarla

Üretilen `docs/data/transit-routes.geojson` bugün şunu içeriyor:

```
10 hat çizgisi + 30 yürüme bağlantısı = 40 feature
kapsam: 30 tesisin 13'ü (%43) bir hatla eşleşti
eşleşemeyen: 88 hat
  ├─ 81 "not-in-any-source"      → hat hiçbir kaynakta yok
  └─  7 "operator-feed-missing"  → vapur hatları (İDO/Şehir Hatları GTFS yayınlamıyor)
```

**%43 düşük bir sayı ve bu bilinçli.** Kapsamı %100'e çıkarmanın kolay yolu eşikleri
gevşetmekti; o zaman haritada 30/30 çizgi olurdu ama bir kısmı yanlış olurdu. Proje
**dürüst %43'ü, güzel görünen %100'e tercih etti.**

> Mentöre söylenecek cümle: *"Kapsamım %43 ve bunu ekranda yazıyorum. İsteseydim eşikleri
> düşürüp %100 gösterirdim, ama o zaman bazı çizgiler uydurma olurdu ve bunu ben de
> bilemezdim."*

Her çizgi kendi kanıtını da taşıyor:

```json
{"kind":"line","ref":"34 (Metrobüs)","mode":"metrobus",
 "match_cov":0.77,"match_dist_m":180,
 "source":"ibb-gtfs","confidence":"geometric-match","geometry_kind":"shape"}
```

`match_cov: 0.77` → duraklarının %77'si oturdu. `match_dist_m: 180` → ortalama 180 m sapma.
Yani çizgiye tıklayan biri **neden orada olduğunu** görebiliyor.

### Ham GTFS neden git'te değil?

`data/gtfs/` `.gitignore`'da. İki sebep: dosya yüzlerce MB ve **türetilebilir**. Git'te
duran şey türetilmiş, ince (93 KB) çıktı. Bu, [06. bölümde](06-ayni-anda-iki-kisi.md) ve
DDIA'da geçen ayrımın aynısı: **kaynak veri vs türetilmiş veri.** Türetilmiş veri her
zaman yeniden üretilebilir, o yüzden versiyon kontrolüne gerek yoktur — ama **üretim
tarifi** (script) versiyon kontrolünde olmalıdır.

---

## 5. SOAP vs REST: iki nesil API

İBB'nin uçları ilginç bir arkeolojik kesit sunuyor — **iki farklı çağın** API tasarımı
yan yana duruyor.

### REST (Metro İstanbul)

```
GET https://api.ibb.gov.tr/MetroIstanbul/api/MetroMobile/V2/GetLines
```

Tarayıcıya yapıştırıp çalıştırabilirsiniz. Yanıt JSON. URL kaynağı, HTTP fiili eylemi
söyler. Öğrenmesi yarım saat.

### SOAP (İETT)

```
POST https://api.ibb.gov.tr/iett/UlasimAnaVeri/HatDurakGuzergah.asmx
Content-Type: text/xml; charset=utf-8
SOAPAction: "http://tempuri.org/GetHat_json"

<?xml version="1.0"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <GetHat_json xmlns="http://tempuri.org/"><HatKodu>34</HatKodu></GetHat_json>
  </soap:Body>
</soap:Envelope>
```

Her şey POST. Adres eylemi söylemez — `SOAPAction` başlığı söyler. Yanıt XML zarfı içinde
XML. Servisin ne yaptığını öğrenmek için `?wsdl` eklenip makine okunur bir şema indirilir.

| | SOAP | REST |
|---|---|---|
| **Doğduğu yıl** | 1998 | 2000 (tez), pratikte 2005+ |
| **Format** | yalnız XML | genelde JSON |
| **HTTP fiilleri** | hep POST | GET/POST/PUT/DELETE |
| **Şema** | WSDL — zorunlu, makine okunur | OpenAPI — isteğe bağlı |
| **Tarayıcıdan denenebilir mi** | hayır | evet |
| **Bugün nerede** | banka, kamu, sigorta, eski kurumsal | web ve mobilin neredeyse tamamı |

**SOAP kötü değil, eski.** WSDL'in verdiği katı sözleşme gerçek bir avantajdır: istemci
kodu otomatik üretilebilir, tip uyuşmazlığı derleme anında yakalanır. Bedeli ağırlık ve
öğrenme eğrisi. Kamu kurumlarının SOAP'ta kalması bir gerilik göstergesi değil, 20 yıllık
entegrasyonları bozmama tercihidir.

> **Ders:** Bir teknolojiyi "eski" diye reddetmek kolay; **neden hâlâ orada olduğunu**
> sormak öğreticidir.

### Bu projede nasıl ele alındı: hoşgörülü ayrıştırma

`scripts/ibb-parse.js` her iki formatı da okur ve gerçek dünyanın pisliğiyle baş eder:

- **Mojibake onarımı.** UTF-8 baytları Latin-1 sanılarak okunmuşsa metin bozulur: `ş`
  harfinin iki baytı (`0xC5 0x9F`) ayrı ayrı karaktere dönüşür ve `Beşiktaş` okunamaz
  hale gelir (Latin-1'de `BeÅiktaÅ`, cp1252 varsayılırsa `BeÅŸiktaÅŸ`). Kod bu deseni
  tanıyıp geri çevirir.
- **Koordinat düzeltme.** Bazı uçlar `lat,lng` yerine `lng,lat` verir, bazıları virgüllü
  ondalık (`41,0369`). İstanbul dışına düşen koordinat reddedilir.
- **Alan adı esnekliği.** `HatKodu` / `hat_kodu` / `LineCode` — hepsi denenir.

`backend/test-ibb-parse.js` bu yolların hepsini gerçek bayt dizileriyle test ediyor.

> **Ağ notu (dürüstlük):** Bu geliştirme ortamının ağ politikası `api.ibb.gov.tr`'yi
> engelliyor (proxy `403` dönüyor). `fetch-ibb.js` bunu **açıkça ayırt ediyor**: ağ engeli
> mi, yoksa abonelik anahtarı eksikliği mi? İkisi çok farklı sorunlar ve script hangisi
> olduğunu söylüyor. Bu yüzden mevcut GeoJSON, önceden indirilmiş GTFS'ten üretildi.

---

## 6. OpenWeather: tek gerçek zamanlı kaynak

Diğer üç kaynak durağan (dosyada duruyor). Hava durumu **her çağrıda değişir** — projedeki
tek canlı veri.

```
GET https://api.openweathermap.org/data/2.5/weather?lat=41.03&lon=28.98&appid=…&units=metric
```

Üç tasarım kararı:

**(a) Anahtar sunucuda, `.env` dosyasında.** Frontend'e koysaydık sayfanın kaynağına bakan
herkes alırdı. `.env` `.gitignore`'da — anahtar **git geçmişine hiç girmedi**.

**(b) `https`, `http` değil.** Anahtar URL sorgu dizesinde gidiyor; şifresiz bağlantıda
aradaki her yönlendirici onu okuyabilirdi.

**(c) Önbellek — ve "her an güncel" ile çelişmemesi.** İlk bakışta önbellek tazeliğin
düşmanı gibi görünür. Değil:

- OpenWeather'ın **kendi verisi** zaten ~10 dakikada bir tazeleniyor. Aradaki çağrılar
  **aynı** değeri döndürür — sadece kotanızı yakar.
- Ücretsiz katman **60 çağrı/dakika**. 30 tesis + ilçe paneli gezinen bir kullanıcı bunu
  kolayca aşar. Aşınca API `429` döner, kod mock'a düşer — yani **önbelleksiz olmak sizi
  daha az güncel yapar.**

Önbellek koordinatı ~1 km'lik hücreye yuvarlar. Burada küçük ama öğretici bir hata çıktı:
ilk sürüm `toFixed(2)` kullanıyordu ve kayan nokta sınırında tutarsız davranıyor —
`(28.985).toFixed(2)` → `"28.98"` ama `(28.9852).toFixed(2)` → `"28.99"`. Yani 20 cm
arayla iki koordinat farklı hücreye düşüyordu. Tam sayı hücre indeksiyle çözüldü:

```js
const cacheKey = (lat, lng) => `${Math.round(lat / 0.01)},${Math.round(lng / 0.01)}`;
```

**Tazeliği kanıtlama.** Yanıt iki alan taşıyor: `observed_at` (OpenWeather'ın kendi ölçüm
zaman damgası) ve `cached` (bu değer önbellekten mi geldi). Mentör *"bu gerçek mi?"*
derse ekranda saat var. `WEATHER_CACHE_TTL_MS=0` verirseniz önbellek tamamen kapanır.

**Anahtar yoksa ne olur?** Kod **asla hata fırlatmaz** — gerçekçi bir İstanbul iklim
modeliyle değer üretir ve `isMock: true` işaretler. Arayüz bu bayrağı görüp "demo" etiketi
gösterir. Yani veri hep var, ama **hangisi olduğu hep belli.**

---

## 7. Sentetik veri: 425 bin satır nereden geldi?

`scripts/generate-data.js` ölçek testi için sahte rezervasyon üretir. Bu **kasıtlı olarak
sahtedir** ve saklanmaz. Ama iki şeyi gerçekten öğretti:

1. **int4 taşması.** Üretilen bir yıllık ciro 106 milyon TL; kuruş cinsinden `int4` sınırı
   21,5 milyon TL. Dashboard tamamen çöktü ([04. bölüm](04-neden-postgresql.md)).
2. **142 MB yanıt.** `/api/admin/reservations` sayfalama olmadan 425.139 satır /
   142.643.985 bayt / 8,7 saniye döndürüyordu. Küçük veriyle bu hata **asla görünmezdi.**

> **Ders:** Sentetik veri gerçeğin yerine geçmez, ama gerçek verinin henüz göstermediği
> hataları gösterir. 30 satırla test eden biri bu iki hatayı da bulamazdı.

**Bir dürüstlük düzeltmesi:** Üretilen 200 kullanıcının hepsi başlangıçta **aynı parola
hash'ini** paylaşıyordu (hız için). DBeaver'da `users` tablosunu açan mentör 200 özdeş
hash görecekti — tam da "her kullanıcıya ayrı salt" anlatısının yanında. Anlatıyı görsel
olarak çürüten bir detay. Düzeltildi: sentetik kullanıcılar artık farklı hash'ler taşıyor.

---

## 8. Kendin dene

**GeoJSON'un kendi kalite raporunu okuyun:**

```bash
node -e "
const g=JSON.parse(require('fs').readFileSync('docs/data/transit-routes.geojson','utf8'));
console.log('hat:', g.meta.line_count, '| yürüme:', g.meta.walk_count);
console.log('kapsam: %' + g.meta.coverage.pct,
            '(' + g.meta.coverage.facilities_with_lines + '/' + g.meta.facility_count + ' tesis)');
const r={}; Object.values(g.meta.unmatched).forEach(x=>r[x]=(r[x]||0)+1);
console.log('eşleşemeyen', g.meta.unmatched_count, '→', r);
"
```

Beklenen:
```
hat: 10 | yürüme: 30
kapsam: %43 (13/30 tesis)
eşleşemeyen 88 → { 'not-in-any-source': 81, 'operator-feed-missing': 7 }
```

**Bir hattın kanıtını görün:**

```bash
node -e "
const g=JSON.parse(require('fs').readFileSync('docs/data/transit-routes.geojson','utf8'));
g.features.filter(f=>f.properties.kind==='line').slice(0,5)
 .forEach(f=>console.log(f.properties.ref.padEnd(22),
   'örtüşme:', f.properties.match_cov, '| sapma:', f.properties.match_dist_m+'m',
   '|', f.properties.confidence));
"
```

**Hava durumunun gerçek olup olmadığını kontrol edin:**

```bash
curl -s 'localhost:8085/api/weather?lat=41.0369&lng=28.9850' | node -pe "
const d=JSON.parse(require('fs').readFileSync(0,'utf8'));
d.isMock ? 'MOCK — sebep: '+d.reason : 'GERÇEK — ölçüm: '+d.observed_at+' | önbellek: '+d.cached
"
```

`GERÇEK` görüyorsanız `.env`'deki anahtar çalışıyor. `MOCK` görüyorsanız `reason` alanı
neden olduğunu söyler (anahtar yok / `HTTP 401` / ağ engeli).

**Ham GTFS'in git'te olmadığını doğrulayın:**

```bash
git check-ignore -v data/gtfs/ .env data/dev-credentials.json
```

Üçü de `.gitignore` kuralıyla eşleşmeli — yani hiçbiri depoda değil.

---

## 9. Mentör sorarsa

**"Bu güzergahlar gerçek mi?"**
> *"Evet, İBB'nin GTFS `shapes` verisinden. Ama hepsi değil: 30 tesisin 13'ü, yani %43'ü
> eşleşti. Eşleşme kalite kapısından geçiyor — hattın duraklarının en az %60'ı shape'e
> oturmalı ve ortalama sapma 350 metreyi geçmemeli. Geçemeyen eşleşme çizilmiyor ve sebebi
> çıktıya yazılıyor. Kapsamı %100 yapabilirdim ama o zaman bazı çizgiler uydurma olurdu."*

**"Neden vapur hatları yok?"**
> *"İDO ve Şehir Hatları GTFS yayınlamıyor. Çıktıda `operator-feed-missing` olarak işaretli
> — 7 hat. Uydurmak yerine eksik olduğunu yazmayı tercih ettim."*

**"SOAP ile REST farkı nedir?"**
> *"SOAP 1998'den, her şey XML zarfında ve hep POST; eylemi `SOAPAction` başlığı söylüyor,
> sözleşme WSDL'de. REST 2000'lerden, JSON ve HTTP fiilleri. İBB'de ikisi de var: Metro
> İstanbul REST, İETT SOAP. SOAP eski ama kötü değil — katı sözleşmesi gerçek bir avantaj,
> ve kamu 20 yıllık entegrasyonları bozmamak için orada kalıyor."*

**"Hava durumu her an güncel mi? Önbellek onu bozmuyor mu?"**
> *"Bozmuyor, tersine koruyor. OpenWeather'ın kendi verisi zaten 10 dakikada bir
> tazeleniyor, aradaki çağrılar aynı değeri döndürüyor. Ücretsiz katman dakikada 60 çağrı;
> önbelleksiz 30 tesis gezmek limiti aşar, aşınca API 429 döner ve mock'a düşerim — yani
> daha az güncel olurum. Yanıtta `observed_at` var, tazeliği ekranda görebiliyorum, ve
> TTL'i sıfırlayıp önbelleği tamamen kapatabiliyorum."*

**"425 bin rezervasyon gerçek mi?"**
> *"Hayır, `generate-data.js` üretti ve git'te değil, ölçek testi için. Ama iki gerçek hata
> buldurdu: para toplamları int4'ü taşırıyordu ve admin ucu sayfalama olmadığı için 142 MB
> döndürüyordu. Otuz satırla test etseydim ikisini de bulamazdım."*

**"Verinin gerçek kaynağı hangisi — veritabanı mı?"**
> *"Hayır, `data/seed.json`. Veritabanı türetilmiş: silip yeniden kurulabilir. Aynı ilke
> GTFS'te de geçerli — ham veri git'te değil çünkü türetilebilir, ama üretim script'i
> git'te çünkü tarif kaybolmamalı."*

---

## Sırada ne var

Teknik bölümler bitti. Karşılaştığınız terimlerin hepsi tek yerde toplandı:
**[11 — Sözlük](11-sozluk.md)**

Teknoloji başına derinlemesine dosyalar için: **[`teknoloji/`](teknoloji/)**
