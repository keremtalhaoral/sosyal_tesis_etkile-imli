# 00 — Bu proje ne yapıyor?

> Bu bölümde **hiç teknik terim yok.** Amaç: projenin ne işe yaradığını, teyzenize
> anlatabilecek kadar net bilmek. Teknoloji sonraki bölümlerde.

---

## 1. Bir cümlede

İstanbul'daki belediye sosyal tesislerini haritada gösteren, oradan yer ayırtıp yemek
siparişi verebildiğiniz, ve yöneticilere "hangi ilçede tesis eksik?" sorusunu yanıtlayan
bir web uygulaması.

---

## 2. Benzetme

**Bir alışveriş merkezinin dokunmatik yönlendirme ekranı gibi düşünün.** Haritada
nerede ne var gösterir, "en yakın kafe nerede?" dersiniz gösterir, masa ayırtabilirsiniz.

**Benzetme nerede bozuluyor:** O ekran yalnızca *gösterir*. Bu proje ayrıca **karar
desteği** verir: yöneticiye *"Sultanbeyli'de 480 bin kişi yaşıyor ama tek bir tesis var,
Beşiktaş'ta 180 bin kişiye üç tesis düşüyor"* der. Yani sadece "nerede ne var" değil,
**"nerede ne eksik"** sorusunu da yanıtlar. Asıl değerli kısım budur.

---

## 3. Biraz daha derin: kim, hangi sorunu yaşıyor?

Projenin üç farklı kullanıcısı var ve her biri farklı bir şey istiyor:

### Vatandaş
> *"Hafta sonu ailemle gidebileceğim, deniz manzaralı, uygun fiyatlı bir yer arıyorum.
> Nasıl giderim? Yer var mı? Park edebilir miyim?"*

Uygulama: haritada tesisler, hangi otobüs/metro gider, o gün doluluk ne, otopark boş mu,
hava nasıl. Beğenirse yer ayırtır, hatta önceden yemek siparişi verir.

### Tesis personeli
> *"Bugün kaç kişi gelecek? Hangi siparişler hazırlanacak? Kim ödedi?"*

Uygulama: rezervasyon listesi, sipariş akışı (`sipariş verildi → servis edildi → ödendi`).

### Belediye yöneticisi
> *"Bütçem sınırlı. Yeni tesisi NEREYE yapmalıyım?"*

Uygulama burada en değerli hâline geliyor: her ilçenin nüfusunu ve tesis sayısını
birleştirip **100 bin kişiye kaç tesis düştüğünü** hesaplar. Az olan ilçeleri kırmızıya
boyar. Yönetici haritaya bakar ve nereye yatırım yapması gerektiğini **görür**.

---

## 4. Neyi ekranda görüyorsunuz?

Üç sayfa var:

| Sayfa | Ne yapar |
|---|---|
| **Ana harita** (`index.html`) | Tesisler, ilçe renklendirmesi, en yakın tesis, yol tarifi, hava durumu, yönetici paneli |
| **Sipariş** (`order.html`) | Rezervasyon yap, menüden seç, sipariş ver |
| **Panel** (`dashboard.html`) | Grafikler: ciro, doluluk yoğunluğu, iptal oranı, hangi tesis daha popüler |

---

## 5. Peki arka planda ne var?

Şimdilik sadece şu resmi aklınızda tutun — ayrıntılar sonraki bölümlerde:

```
   Tarayıcınız                  Sunucu                     Veritabanı
   (haritayı çizer)   ←──→   (kuralları uygular)   ←──→   (veriyi saklar)
```

Üç ayrı iş, üç ayrı yerde:

- **Tarayıcı** güzel görünmekten sorumlu. Haritayı çizer, tıklamaları dinler.
- **Sunucu** kurallardan sorumlu. *"Bu kişi gerçekten giriş yaptı mı? Bu tesiste yer kaldı
  mı? Bu siparişin toplamı ne?"* Tarayıcıya asla güvenmez — çünkü tarayıcıdaki kod
  kullanıcının bilgisayarında çalışır ve değiştirilebilir.
- **Veritabanı** hatırlamaktan sorumlu. Bilgisayar kapansa bile veri durur.

> **Neden üçe ayrılmış?** Herkesin bilgisayarında ayrı bir kopya olsaydı, sizin
> ayırttığınız yeri başkası göremezdi. Ortak bir yerde tek bir doğru kayıt olmalı.
> Buna **tek gerçek kaynak** (single source of truth) deniyor ve bu projenin en temel
> tasarım kararı bu.

---

## 6. Kendin dene

Hiçbir şey kurmadan, projenin şu anki verisine bakın:

```bash
cat data/seed.json | head -40
```

Bu dosya projenin **başlangıç verisi**: 30 tesis, adları, koordinatları, kapasiteleri.
İnsan okuyabilsin diye JSON formatında ve git'te duruyor. Veritabanı bu dosyadan kuruluyor.

Kaç tesis var, hangi ilçelerde?

```bash
node -e "
const s=require('./data/seed.json');
console.log(s.facilities.length + ' tesis');
console.log('İlk 5:', s.facilities.slice(0,5).map(f=>f.ad).join(', '));
console.log(s.districts.length + ' ilçe nüfus verisi');
"
```

---

## 7. Mentör sorarsa

**"Bu proje ne işe yarıyor?"**
> *"İstanbul'un sosyal tesisleri için hem vatandaşa yönelik bir rezervasyon/sipariş
> uygulaması, hem de yöneticiye yönelik bir karar destek aracı. Asıl özgün kısmı ikincisi:
> nüfus verisiyle tesis dağılımını birleştirip hangi ilçede tesis açığı olduğunu haritada
> gösteriyor."*

**"Neden buna ihtiyaç var, Google Maps yeterli değil mi?"**
> *"Google Maps 'nerede ne var' sorusuna cevap verir. Bu proje 'nerede ne eksik' sorusuna
> cevap veriyor — ki bu bir planlama sorusu ve nüfus verisiyle tesis verisini birleştirmeyi
> gerektiriyor. Ayrıca rezervasyon/sipariş gibi işlemsel kısımlar da Maps'te yok."*

---

## Sırada ne var

Şimdi "tarayıcı ↔ sunucu ↔ veritabanı" resminin ilk okunu açalım:
**[01 — Web nasıl çalışır?](01-web-nasil-calisir.md)**
