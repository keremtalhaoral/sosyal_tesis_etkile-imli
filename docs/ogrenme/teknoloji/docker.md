# Docker (ve docker compose)

## 1. Tek cümlede

Docker, bir uygulamayı **tüm bağımlılıklarıyla birlikte** izole bir paket (konteyner)
içinde çalıştırır; böylece "bende çalışıyordu" sınıfı sorunlar ortadan kalkar.

**Bu projede:** yalnız veritabanı için. İmaj `postgis/postgis:16-3.4`,
`npm run db:up` ile ayağa kalkar.

---

## 2. Hangi problemi çözmek için doğdu

2013 öncesi bir yazılımı çalıştırmak şu demekti: doğru dil sürümü, doğru kütüphane
sürümleri, doğru sistem paketleri, doğru yapılandırma — ve bunların **her makinede
tekrarlanması**. Farklı bir işletim sistemi, farklı bir paket yöneticisi, farklı sonuç.

Sanal makineler bunu çözüyordu ama pahalıya: her VM kendi işletim sistemi çekirdeğini
taşıyor, gigabaytlar yer kaplıyor, dakikalarca açılıyor.

Docker'ın fikri: **çekirdeği paylaş, geri kalanını izole et.** Linux'un zaten sahip olduğu
namespace ve cgroup mekanizmalarını kullanarak süreçleri birbirinden yalıtıyor. Sonuç:
VM'nin izolasyonuna yakın, ama saniyeler içinde açılan ve megabaytlarla ölçülen paketler.

### Bu projede tam olarak hangi acıyı çözüyor

**PostGIS'i elle kurmak platforma göre değişir.** macOS'ta Homebrew, Ubuntu'da apt,
Windows'ta installer — ve en sık karşılaşılan sorun **sürüm uyumsuzluğu**: PostgreSQL 16
kurdunuz ama depoda PostGIS 3.3 var, ya da tam tersi.

`postgis/postgis:16-3.4` imajı ikisini **birbirine uyumlu sabitlenmiş sürümlerle**
getiriyor. Kurulum adımı yok, sürüm tartışması yok.

---

## 3. Alternatifler ve neden onlar değil

| Alternatif | Güçlü yanı | Bu projede neden değil |
|---|---|---|
| **Elle kurulum** (apt/brew) | Docker gerekmez | platform başına farklı adım; PostGIS sürüm uyumu en sık kurulum sorunu |
| **Bulut veritabanı** (Supabase, Neon) | kurulum sıfır | internet şart; sunum salonunda ağ garantisi yok; ücretsiz katman sınırları |
| **Podman** | daemonsuz, rootless | compose uyumu ve yaygınlık; öğrenme projesinde Docker daha çok belgelenmiş |
| **Uygulamayı da konteynerleştirmek** | tam tekrarlanabilirlik | geliştirme döngüsünü yavaşlatır; kod değişince yeniden derleme. Node zaten her yerde aynı |

**Belirleyici sebep:** Docker burada **yalnız veritabanı için** kullanılıyor — yani en çok
acı çektiren parça için. Uygulama doğrudan `node` ile koşuyor, çünkü Node'un kurulumu
zaten sorunsuz ve konteynerlemek geliştirme hızını düşürürdü. Aracı **her yere değil,
gerektiği yere** uygulamak.

---

## 4. Bu projede tam olarak nerede

`docker-compose.yml`:

```yaml
services:
  db:
    image: postgis/postgis:16-3.4
    container_name: mufettis-db
    restart: unless-stopped
    environment:
      POSTGRES_DB:       ${PGDATABASE:-mufettis}
      POSTGRES_USER:     ${PGUSER:-mufettis}
      POSTGRES_PASSWORD: ${PGPASSWORD:-mufettis-dev}
      POSTGRES_INITDB_ARGS: "--encoding=UTF8"     # 'İ', 'ş', 'ğ' için
    ports:
      - "${PGPORT:-5432}:5432"
    volumes:
      - pgdata:/var/lib/postgresql/data           # named volume: veri kalıcı
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ${PGUSER:-mufettis} -d ${PGDATABASE:-mufettis}"]
      interval: 5s
      timeout: 5s
      retries: 10

volumes:
  pgdata:
```

Dört ayrıntı, dördü de bilinçli:

**`${PGUSER:-mufettis}`** — ortam değişkeni varsa onu, yoksa varsayılanı kullan. Aynı
dosya hem geliştirmede hem başka bir yapılandırmada çalışır.

**`healthcheck`** — "konteyner ayakta" ile "veritabanı sorgu kabul ediyor" **aynı şey
değildir.** `initdb` sırasında port açıktır ama veritabanı hazır değildir. `pg_isready`
gerçek hazırlığı ölçer.

**Named volume (`pgdata`)** — veri konteynerin **dışında** yaşıyor. `docker compose down`
konteyneri siler, veri kalır. Silmek için açıkça `down -v` demek gerekir.

**`POSTGRES_INITDB_ARGS: "--encoding=UTF8"`** — ilçe adları `Beşiktaş`, `Şişli`, `Üsküdar`
içeriyor. Yanlış kodlama seçilirse sorun **kurulum anında** değil, aylar sonra bir
sıralama ya da karşılaştırmada ortaya çıkar.

---

## 5. Bilinmesi gereken üç tuzak

### (a) `docker compose down -v` verinizi siler

`-v` bayrağı named volume'ları da siler. Bu projede kurtarılabilir (seed'den yeniden
kurulur), ama gerçek bir projede felakettir. Kas hafızası tehlikeli: `down` güvenli,
`down -v` değil.

### (b) Konteyner ayakta ≠ veritabanı hazır

`docker compose up -d` komutu hemen döner, ama PostgreSQL ilk açılışta `initdb`
çalıştırır ve bu saniyeler sürer. Healthcheck olmadan `npm start` "connection refused"
alır ve bu **rastgele** olur — bazen çalışır bazen çalışmaz, en sinir bozucu hata türü.

### (c) Port çakışması

Makinenizde zaten bir PostgreSQL varsa 5432 doludur ve konteyner açılmaz. Çözüm:

```bash
PGPORT=5433 npm run db:up
# ve backend'e de aynı portu söyleyin:
PGPORT=5433 npm start
```

Hata mesajı (`port is already allocated`) net, ama ilk karşılaşıldığında anlaşılmıyor.

---

## 6. Kendin dene

```bash
npm run db:up                      # ayağa kaldır
docker ps                          # mufettis-db "healthy" mi?
docker compose logs db | tail -20  # başlangıç logları

# konteynerin içindeki psql'e girin (host'ta psql kurulu olmasa bile)
docker exec -it mufettis-db psql -U mufettis -d mufettis -c "SELECT postgis_version();"

# veri gerçekten volume'da mı? konteyneri silip geri açın
docker compose down && npm run db:up
docker exec -it mufettis-db psql -U mufettis -d mufettis -c "SELECT COUNT(*) FROM facilities;"
# veri hâlâ orada ← named volume çalışıyor

npm run db:down                    # durdur (veri KALIR)
```

---

## 7. Daha fazlası için

- Compose dosya referansı: <https://docs.docker.com/reference/compose-file/>
- PostGIS imajı: <https://registry.hub.docker.com/r/postgis/postgis>
- Bu kitapta: [04 — Neden PostgreSQL?](../04-neden-postgresql.md)
- Projede: `docker-compose.yml` (yorumları okumaya değer), `DATABASE.md`
