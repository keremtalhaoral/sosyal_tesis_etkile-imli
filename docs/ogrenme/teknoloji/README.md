# Teknoloji Dosyaları

Katmanlı kitap ([`../`](../)) **"neden"** anlatır — kararların hikâyesi. Bu klasör
**"ne"** anlatır: her teknoloji tek başına, referans olarak okunabilsin diye.

**Her dosyanın yapısı aynı:**

1. **Tek cümlede ne** — tanım.
2. **Hangi problemi çözmek için doğdu** — teknolojiler boşlukta doğmaz; bir acıya cevaptır.
   O acıyı bilmezseniz teknolojiyi ezberlersiniz.
3. **Alternatifleri ve neden onlar seçilmedi** — seçmediklerinizi bilmiyorsanız seçim
   yapmamışsınız demektir.
4. **Bu projede tam olarak nerede** — dosya, satır, komut.
5. **Bilinmesi gereken tuzaklar** — genellikle üç tane, mümkünse bu projede fiilen yaşanmış.
6. **Daha fazlası için** — resmî kaynak.

---

## Katman katman

### Veri
| Dosya | Ne |
|---|---|
| [postgresql.md](postgresql.md) | veritabanı sunucusu (v16) |
| [postgis.md](postgis.md) | mekansal eklenti (v3.4) |
| [pg-driver.md](pg-driver.md) | Node ↔ PostgreSQL sürücüsü ve bağlantı havuzu |
| [docker.md](docker.md) | veritabanını tek komutla ayağa kaldırma |
| [dbeaver.md](dbeaver.md) | veritabanı GUI'si — sunum aracı |

### Sunucu
| Dosya | Ne |
|---|---|
| [nodejs.md](nodejs.md) | JavaScript çalışma ortamı, olay döngüsü |
| [express.md](express.md) | HTTP yönlendirme ve middleware |
| [jwt.md](jwt.md) | imzalı oturum bileti |
| [sse.md](sse.md) | sunucudan tarayıcıya canlı bildirim |
| [pbkdf2.md](pbkdf2.md) | parola hash'leme |

### Tarayıcı
| Dosya | Ne |
|---|---|
| [leaflet.md](leaflet.md) | harita kütüphanesi |
| [turf.md](turf.md) | tarayıcı-içi geometri |
| [chartjs.md](chartjs.md) | grafikler |

### Veri formatları ve dış dünya
| Dosya | Ne |
|---|---|
| [geojson.md](geojson.md) | coğrafi veri formatı |
| [gtfs.md](gtfs.md) | toplu taşıma veri standardı |
| [soap-vs-rest.md](soap-vs-rest.md) | iki nesil API tasarımı |
| [git-github-pages.md](git-github-pages.md) | versiyon kontrolü ve yayınlama |

---

> **Okuma tavsiyesi:** Bu dosyaları baştan sona okumayın. Katmanlı kitabı okurken bir
> teknoloji kafanızı karıştırdığında buraya gelin, sonra kitaba dönün.
