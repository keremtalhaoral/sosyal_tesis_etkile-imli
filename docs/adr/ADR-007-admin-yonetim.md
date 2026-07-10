# ADR-007: Gelişmiş Admin Paneli (audit log + sipariş yaşam döngüsü + gözetim)

- **Durum:** Kabul edildi
- **Faz / Dal:** `v2-07-admin-panel`
- **Tarih:** 2026-07
- **Referans:** DDIA Böl. 7 (Transactions/atomiklik), Böl. 11 (event log / captured vs derived)
- **İlgili:** `backend/database.js` (migration v6), `backend/db.js` (`logAudit`, `updateOrderStatus`,
  `getAllReservations`, `getAllOrders`), `backend/server.js`, `docs/app.js` (admin panel UI +
  mock interceptor), `docs/order.js`, `ADR-003` (İSPARK gap), `ADR-005` (sipariş borcu)

## Bağlam

CLAUDE.md faz sırasının **son fazı**. Mentör 4.d maddesi ("admin panel gelişmiş özellikler").
Keşif: rol tabanlı auth (`users.role`, JWT `role` claim, `requireAdmin`) ve temel tesis CRUD
zaten çalışıyordu; üç ADR bu fazı **önceden belgelenmiş borç** olarak işaretlemişti — sipariş tam
yaşam döngüsü yok (ADR-005), `createFacility` İSPARK kaydı üretmiyor (ADR-003), `audit_log`
şeması tasarlanmış ama migration yoktu (`docs/diagrams/er-v2.md`).

## Karar 1 — audit_log: APPEND-ONLY olay kaydı (DDIA Böl. 11)

**Karar:** `audit_log` yalnız `INSERT` edilir; hiçbir kod yolu `UPDATE`/`DELETE` yapmaz. Her
admin yazma işlemiyle (tesis create/update/delete, sipariş durum geçişi) **AYNI transaction**
içinde yazılır (`logAudit(conn, ...)` — `db.js`), böylece mutasyon ve kaydı birlikte
commit/rollback olur; yarım kalmış bir işlem sahte bir denetim izi bırakmaz.

**Neden:** Bir denetim kaydının **kendisi bir olgu**dur (Böl. 11, captured vs derived ayrımının
event-log versiyonu) — geçmişte gerçekten ne olduğunu değiştirmeden yansıtmalı. Atomiklik
olmadan (ayrı transaction) "işlem oldu ama loglanmadı" veya tam tersi senaryolar mümkün olurdu.

## Karar 2 — Sipariş durum makinesi: whitelist geçişler (submitted→served→paid)

**Karar:** `createOrder` artık `'submitted'` ile başlar (eskiden direkt `'paid'`). Yalnız şu
geçişlere izin var: `submitted→served`, `served→paid`, `(submitted|served)→cancelled`. Başka her
geçiş (örn. `submitted→paid` sıçraması) 409 ile reddedilir. `PATCH /api/orders/:id/status`
(`requireAdmin`) bu makineyi çalıştırır.

**Neden:** ADR-005'in bıraktığı borç ("personel servis/ödeme akışı v2-07'de") burada kapanıyor.
Whitelist yaklaşımı (durum→izinli-sonraki-durumlar haritası) rastgele string kabul etmez;
sipariş asla "geçersiz" bir duruma sıçrayamaz (DDIA'nın "geçerli durumlar kümesi daralt" ilkesiyle
tutarlı invariant). Test: `submitted→paid` reddedilir, `submitted→served→paid` kabul edilir.

## Karar 3 — Admin gözetim: sahiplik filtresi YOK, requireAdmin ile korunur

**Karar:** `GET /api/admin/reservations`, `GET /api/admin/orders` tüm kullanıcıların verisini
döner (normal `/api/reservations` gibi `user_id` filtresi yok). Güvenlik `requireAdmin`
middleware'inde: admin olmayan JWT veya token yoksa 403.

**Neden:** Bu, mevcut sahiplik-kontrollü uçlardan (ADR-005 Karar 3) **kasıtlı bir istisna** —
admin rolünün TANIMI budur ("tüm veriye gözetim yetkisi"). Filtre kaldırmak güvenlik açığı değil,
çünkü erişim zaten rol kontrolünden geçiyor (403 testli: `backend/test-admin.js`).

## Karar 4 — İSPARK kapasitesi: opsiyonel alan (ADR-003 gap kapanışı)

**Karar:** `createFacility`'ye opsiyonel `isparkCapacity` eklendi; verilirse aynı transaction
içinde `ispark_status` satırı da oluşturulur. Boş bırakılırsa otopark kaydı **hiç oluşmaz**
(mevcut "Mevcut Değil" desenine uyumlu — zorunlu alan değil).

**Neden:** Her sosyal tesisin otoparkı olmayabilir; zorunlu alan yanlış varsayım olurdu. Kullanıcı
seçimi (Faz 7 sorusu) da bu yönde.

## Karar 5 — Legacy hata düzeltmeleri (bu fazda keşfedildi, aynı yerde onarıldı)

Admin panelini genişletirken üç **önceden var olan, admin akışını tamamen kıran** hata bulundu ve
düzeltildi (yeni özellik değil, mevcut sözleşmenin onarımı):

1. **Tesis oluşturma:** `submitAdminFacility` backend'in beklediği `kod`/`ad` alanlarını hiç
   göndermiyordu (`name` gönderiyordu) → canlı backend'de her zaman 400. Artık `kod` otomatik
   üretiliyor (`slugifyFacilityCode`), `ad` doğru gönderiliyor.
2. **Tesis silme:** `DELETE /api/facilities?id=X` (sorgu parametresi) backend'in gerçek rotasıyla
   (`/api/facilities/:id`, yol parametresi) hiç eşleşmiyordu → canlı backend'de her zaman
   başarısız. URL düzeltildi.
3. **Giriş:** `handleAuthSubmit` `/api/login`/`/api/register`'a POST ediyordu; gerçek uçlar
   `/api/auth/login`/`/api/auth/register`. Düzeltildi.

**Not (mimari netlik):** `docs/index.html`'in girişi **kasıtlı olarak** yalnız `seed.demo_users`
üzerinden çalışır (satır: "Pages auth yalnız demo_users'tan beslenir (gerçek backend
kullanıcıları parola taşımaz)") — statik siteye gerçek parola hash'i asla gönderilmez (ADR-002
ile tutarlı güvenlik sınırı). Bu yüzden ana harita sayfasındaki `window.fetch` override'ı
(`docs/app.js`) **her zaman** bilinen uçları (facilities/menu/login/vb.) tarayıcı-içi simüle eder;
gerçek backend'e hiç gitmez. v2-07'de bu simülatöre yeni uçlar (`facilities` PATCH, `orders/:id/
status`, `admin/orders`, `admin/reservations`, `admin/audit-log`) eklendi ve **bilinmeyen** uçlar
artık sahte `200`/`null` DÖNDÜRMEK yerine gerçek ağa düşüyor (`originalFetch` passthrough) — böylece
gelecekte eklenecek uçlar sessizce bozulmaz. `docs/order.html`/`order.js` bu sayfadan bağımsız
(ayrı navigasyon, kendi `window.fetch`'i) — gerçek dual-mode (canlı dene → localStorage'a düş)
zaten oradaydı, dokunulmadı.

## Sonuç

Migration v6 (`audit_log`, Node+Python senkron) + sipariş state machine + admin gözetim uçları +
İSPARK opsiyonel alan + admin panel UI (doluluk hızlı-düzenleme, gözetim listesi, audit log
görünümü, açık/koyu tema) + üç legacy hata onarımı. Testler: `backend/test-admin.js` (15/15) +
güncellenmiş `backend/test-orders.js` (21/21, sipariş yaşam döngüsü); tüm paket 117/117 yeşil.
