# Workspace Rules

- You are my eyes on the code. If something catches your attention while reading code or logs - a bug, a risk, a smell, something surprising - flag it, even if it's unrelated to the task at hand. I will never see it unless you tell me.

## Rehber kitaplar (guiding books)
- **DDIA — Designing Data-Intensive Applications (Kleppmann):** veri kararları (depolama, tutarlılık,
  eşzamanlılık, türetilmiş veri). Her mimari karar `docs/adr/` altında bir ADR'ye bağlanır.
- **APoSD — A Philosophy of Software Design (Ousterhout):** modül/kod tasarımı. Karmaşıklığı yönetmek
  birincil hedef; aşağıdaki kurallar bu kitaptan damıtıldı.

## Geliştirici kuralları (abartmadan, yüksek sinyal)
1. **Derin modül tercih et.** Basit arayüz, zengin gövde: karmaşıklığı çağıran değil modül saklar
   (örn. `db.js` mekansal + kapasite mantığını; `server.js` handler'ları yalın). (APoSD)
2. **Hatayı tasarımla yok et.** `try/catch` yığmak yerine hatanın oluşamayacağı yolu seç
   (hava durumu/menü fallback'leri, atomik `transaction()` ile write-skew'i imkânsız kılmak). (APoSD)
3. **Karmaşıklığı öne çıkar, saklama.** İsimler niyeti anlatsın; yorum *neden*i açıklasın (*ne*yi değil).
4. **Para = tam sayı kuruş (`*_minor`), asla float.** Tutarlar sunucuda hesaplanır, istemciye güvenilmez.
   (ADR-001/005)
5. **Şema değişince Node + Python senkron:** `backend/database.js` MIGRATIONS **ve**
   `advanced-gis/app/models.py` birlikte; yeni faz = yeni migration versiyonu.
6. **Her faz bir bütün teslim eder:** kod + **ADR** + testler + (UI ise) açık/koyu tema doğrulaması.
7. **Yeni dosya/teknoloji = belge güncelle:** `TEKNOLOJI_VE_DOSYA_REHBERI.md` (dosya-dosya katalog +
   değişiklik günlüğü). CDN yok — dış kütüphaneler `docs/vendor/`'a alınır, offline çalışmalı.

> Not: Bu kurallar `CLAUDE.md`'deki gömülü kararların özeti/pekiştirmesidir; çelişki olursa ADR'ler esastır.
