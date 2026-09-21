# SOAP vs REST

## 1. Tek cümlede

SOAP ve REST, iki farklı kuşağın "programlar birbiriyle nasıl konuşmalı?" sorusuna
verdiği iki farklı cevaptır — ve İBB'nin API'lerinde **ikisi de** yan yana duruyor.

**Bu projede:** Metro İstanbul uçları REST/JSON, İETT uçları SOAP/XML.
`scripts/fetch-ibb.js` ikisini de konuşuyor.

---

## 2. Hangi problemi çözmek için doğdular

### SOAP (1998) — "ağ üstünden fonksiyon çağırmak"

1990'ların sorusu şuydu: *"Başka bir makinedeki fonksiyonu, sanki yerel bir fonksiyonmuş
gibi nasıl çağırırım?"* Dönemin cevabı **RPC** (Remote Procedure Call) idi ve her satıcının
kendi uyumsuz sürümü vardı (CORBA, DCOM, Java RMI).

SOAP'ın teklifi: **XML ile taşınabilir bir RPC.** Herkes XML okuyabildiğine göre, çağrıyı
XML zarfına koyalım.

```xml
POST /iett/UlasimAnaVeri/HatDurakGuzergah.asmx
Content-Type: text/xml; charset=utf-8
SOAPAction: "http://tempuri.org/GetHat_json"

<?xml version="1.0"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <GetHat_json xmlns="http://tempuri.org/"><HatKodu>34</HatKodu></GetHat_json>
  </soap:Body>
</soap:Envelope>
```

Yanında **WSDL** geliyor: servisin makine okunur sözleşmesi. `?wsdl` ekleyip indirirsiniz
ve araçlar istemci kodunu **otomatik üretir.**

### REST (2000) — "kaynakları adresle"

Roy Fielding doktora tezinde farklı bir şey söyledi: *ağ üstünden fonksiyon çağırmayı
bırakın; **kaynakları** adresleyin ve HTTP'nin zaten sahip olduğu fiilleri kullanın.*

```
GET https://api.ibb.gov.tr/MetroIstanbul/api/MetroMobile/V2/GetLines
```

Tarayıcıya yapıştırıp çalıştırabilirsiniz. Yanıt JSON. URL **neyi**, HTTP fiili **ne
yapılacağını** söyler. Öğrenmesi yarım saat.

---

## 3. Yan yana

| | SOAP | REST |
|---|---|---|
| **Doğduğu yıl** | 1998 | 2000 (tez), pratikte 2005+ |
| **Format** | yalnız XML | genelde JSON |
| **HTTP fiilleri** | hep `POST` | `GET`/`POST`/`PUT`/`DELETE` |
| **Eylemi ne söyler** | `SOAPAction` başlığı | URL + fiil |
| **Sözleşme** | **WSDL** — zorunlu, makine okunur | OpenAPI — isteğe bağlı |
| **İstemci kodu** | otomatik üretilebilir | elle yazılır |
| **Tarayıcıdan denenebilir mi** | hayır | evet |
| **Hata bildirimi** | `<soap:Fault>` gövdesinde | HTTP durum kodu |
| **Yük** | ağır (zarf + ad alanları) | hafif |
| **Bugün nerede** | banka, kamu, sigorta, eski kurumsal | web ve mobilin neredeyse tamamı |

---

## 4. "SOAP kötü" demek kolay — neden hâlâ orada?

Bu, mentöre verilebilecek en olgun cevaplardan biri:

**(a) WSDL gerçek bir avantaj.** Katı sözleşme demek, istemci kodunun **otomatik
üretilebilmesi** ve tip uyuşmazlığının **derleme anında** yakalanması demek. REST'te
`{"kapasite": "50"}` mi `{"kapasite": 50}` mi geleceğini çalışma anında öğrenirsiniz.
OpenAPI bu boşluğu doldurmaya çalışıyor ama **zorunlu değil**, dolayısıyla çoğu API'de yok.

**(b) Geriye dönük uyumluluk.** Kamu kurumlarının 20 yıllık entegrasyonları var. SOAP
servisini kapatmak, bağlı onlarca sistemi bozmak demek. Orada kalmaları bir gerilik
göstergesi değil, **maliyet hesabı.**

**(c) Kurumsal ekosistem.** İşlem yönetimi (WS-Transaction), mesaj düzeyinde güvenlik
(WS-Security) gibi standartlar SOAP dünyasında olgun. REST'te bunlar ya yok ya
uygulamaya bırakılmış.

> **Ders:** Bir teknolojiyi "eski" diye reddetmek kolay; **neden hâlâ orada olduğunu**
> sormak öğreticidir. İBB'nin uçları bir arkeolojik kesit sunuyor — iki kuşağın tasarımı
> yan yana, ikisi de çalışıyor.

---

## 5. Bu projede tam olarak nerede

`scripts/fetch-ibb.js` — yedi uç, iki protokol:

```
REST (Metro İstanbul)
  GET  MetroIstanbul/api/MetroMobile/V2/GetLines
  GET  MetroIstanbul/api/MetroMobile/V2/GetStations
  GET  MetroIstanbul/api/MetroMobile/V2/GetDirections

SOAP (İETT)
  POST iett/UlasimAnaVeri/HatDurakGuzergah.asmx      hat → durak + güzergah
  POST iett/UlasimAnaVeri/PlanlananSeferSaati.asmx   planlanan sefer saati
```

`scripts/ibb-parse.js` — **hoşgörülü ayrıştırma** (tolerant parsing). Gerçek dünya
verisi temiz gelmiyor:

- **Mojibake onarımı** — UTF-8 baytları Latin-1 sanılarak okunmuşsa `Beşiktaş` bozulur:
  `ş` harfinin iki baytı (`0xC5 0x9F`) ayrı ayrı karaktere dönüşür. Latin-1'de bu
  `Å` + görünmez bir kontrol karakteridir (ekranda `BeÅiktaÅ`); cp1252 varsayılırsa
  klasik `BeÅŸiktaÅŸ` görüntüsü çıkar. Kod bu deseni tanıyıp geri çeviriyor.
- **Koordinat düzeltme** — bazı uçlar `lng,lat` sırasıyla verir, bazıları virgüllü
  ondalık (`41,0369`). İstanbul sınırları dışına düşen koordinat **reddediliyor**.
- **Alan adı esnekliği** — `HatKodu` / `hat_kodu` / `LineCode`, hepsi deneniyor.

`backend/test-ibb-parse.js` bu yolları **gerçek bayt dizileriyle** test ediyor (17 test).

### Ağ notu — dürüstlük

Bu geliştirme ortamının ağ politikası `api.ibb.gov.tr`'yi engelliyor (proxy `403`).
`fetch-ibb.js` bunu **açıkça ayırt ediyor**:

```
[ibb] Engel ARADAKİ AĞDAN geliyor (proxy/güvenlik duvarı api.ibb.gov.tr'yi
      engelliyor). Abonelik anahtarı almak çözmez.
```

**Ağ engeli mi, abonelik anahtarı eksikliği mi?** İkisi tamamen farklı sorunlar ve
farklı çözümler gerektiriyor. Ayırt etmeyen bir hata mesajı saatlerinizi yakar.

---

## 6. Bilinmesi gereken üç tuzak

### (a) SOAP'ta HTTP `200` başarı demek **değildir**

SOAP hatayı gövdedeki `<soap:Fault>` ile bildirir; HTTP kodu `200` kalabilir. Sadece
duruma bakan bir istemci hatayı **başarı** sanır ve boş veriyi işlemeye devam eder.

### (b) `SOAPAction` başlığını unutmak

Bazı sunucular bu başlık olmadan isteği reddeder, bazıları sessizce yanlış işlemi çağırır.
URL'ye bakarak anlayamazsınız — WSDL'i okumak zorundasınız.

### (c) `?wsdl` olmadan servisi anlayamazsınız

REST'te uca `GET` atıp yanıta bakarsınız. SOAP'ta hangi metotlar var, hangi parametreleri
alıyor — hiçbiri adresten görünmez. Önce WSDL'i indirip okumak gerekir.

---

## 7. Kendin dene

```bash
# İBB uçlarını deneyin (bu ortamda ağ engelli — mesaj bunu SÖYLEYECEK)
npm run fetch:ibb

# ayrıştırıcı testleri (ağ gerekmez, gerçek bayt dizileriyle)
node backend/test-ibb-parse.js
```

Mojibake onarımını kendiniz görün:

```bash
node -e "
const bozuk = Buffer.from('Beşiktaş','utf8').toString('latin1');
console.log('bozuk :', bozuk);
console.log('onarım:', Buffer.from(bozuk,'latin1').toString('utf8'));
"
```

Bir SOAP zarfının nasıl göründüğünü görün:

```bash
grep -n -A12 "SOAP 1.1 zarfı" scripts/fetch-ibb.js
```

---

## 8. Daha fazlası için

- SOAP 1.1: <https://www.w3.org/TR/2000/NOTE-SOAP-20000508/>
- Fielding'in tezi (REST bölümü):
  <https://ics.uci.edu/~fielding/pubs/dissertation/rest_arch_style.htm>
- Bu kitapta: [10 — Veri nereden geliyor](../10-veri-nereden-geliyor.md),
  [01 — Web nasıl çalışır](../01-web-nasil-calisir.md)
- Projede: `docs/adr/ADR-008-*.md`, `scripts/fetch-ibb.js`, `scripts/ibb-parse.js`
