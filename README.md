# kalos-nft-mint

Scan drop + auto-mint NFT di **kalos.fun** (Elysium testnet, chainId **99801**, gas native **HYPE**).
Satu wallet, presign sniper tepat waktu, retry otomatis tiap ~10 detik, watchdog pengawas presign.

Repo ini berisi **hanya** pipeline minting: scan drop per jam, mint langsung, presign scheduler,
retry loop, watchdog, dan contoh one-off untuk kasus eligibility usang (outlaws).
Tidak ada bot trading (buyer/watch/swap/LP) — itu repo lain.

> **Bahasa:** dokumen ini Indonesia. Semua jam di log memakai **WITA (UTC+8)**.
> **Status:** kode ini dipakai live sejak 4 Nov 2026 dan sudah mem-mint puluhan stage
> (punks 5/5, the-obol, mori, hypaww, HMG, dll). Bukan teori — ini kode produksi yang jalan.

---

## 1. Cara cepat jalan (quick start)

### Prasyarat

- Node.js **20+** (teruji di v24) + npm.
- Satu wallet EVM (Elysium testnet) berisi **HYPE** — untuk gas + harga mint.
  Saldo bebas minimal **1 HYPE** harus tersisa setelah mint (guard di semua script).
- RPC Elysium testnet. Default di kode = public Kinetiq
  `https://testnet-rpc.elysium.kinetiq.xyz` (kadang rate-limit / 403).
  **Disarankan:** Alchemy Elysium testnet
  `https://elysium-testnet.g.alchemy.com/v2/<ALCHEMY_KEY>` — lebih stabil.

### Install

```bash
git clone https://github.com/Skyzee2704/kalos-nft-mint.git
cd kalos-nft-mint
npm install   # viem ^2
```

### Env (wajib)

```bash
cp .env.example .env   # lalu isi — JANGAN pernah commit .env
export KALOS_PRIVATE_KEY="0x..."        # private key wallet minting (tanpa 0x juga bisa)
export KALOS_RPC="https://elysium-testnet.g.alchemy.com/v2/<key>"
export KALOS_WALLET_ADDRESS="0x..."    # opsional; default 0xE9973af1b69E407745926fA985C0090E0e78DcF1
```

> **KEAMANAN — BACA DULU:**
> - Private key **hanya** lewat env `KALOS_PRIVATE_KEY`. Jangan pernah di-print, di-log,
>   di-commit, dikirim ke chat, atau ditulis ke file `.env` yang ikut ke repo.
> - Semua script **dry-run** secara default: tanpa `LIVE=1` tidak ada transaksi yang dikirim.
>   Selalu dry-run dulu sebelum `LIVE=1`.
> - Token hasil mint otomatis tercatat di `hold-mint.json` = **LOCKED, tidak boleh dijual**.

### Cek cepat (tanpa kirim tx)

```bash
# Lihat semua drop + eligibility wallet kamu (tanpa key pun bisa, read-only API)
node drop-scan.mjs

# Dry-run mint langsung untuk stage yang sudah buka (simulasi dulu, tanpa kirim)
node drop-mint.mjs <slug> allow "<Stage Name>"
node drop-mint.mjs <slug> public

# Dry-run presign (sign lokal, tidak broadcast) — pakai --fake-start untuk test latency
TESTQ=1 node mint-sched.mjs <slug> "<Stage Name>" --fake-start=$(( $(date +%s) + 120 ))
```

### Jalan live

```bash
# Scan per jam (cron) — pasang presign untuk stage mendatang + mint langsung stage yang sudah buka
# contoh cron (Asia/Makassar): 34 * * * *  cd /path/kalos-nft-mint && KALOS_PRIVATE_KEY=... KALOS_RPC=... node drop-scan.mjs

# Mint langsung satu stage (live)
LIVE=1 node drop-mint.mjs <slug> allow "<Stage Name>"
LIVE=1 node drop-mint.mjs <slug> public

# Presign manual satu stage (live, jalan di background sampai stage buka lalu broadcast)
setsid env LIVE=1 node mint-sched.mjs <slug> "<Stage Name>" >> drop-sched.log 2>&1 < /dev/null &

# Retry loop 10 detik untuk satu stage (live, background; berhenti sendiri kalau terminal)
setsid bash retry-mint-loop.sh <slug> "<Stage Name>" <open_epoch> <end_epoch> 120 [allow|public] >> <slug>-retry.log 2>&1 < /dev/null &
```

---

## 2. Peta file

| File | Peran |
|---|---|
| `drop-scan.mjs` | Scan `GET /v2/launch/drops` + eligibility per drop, tiap jam. Pasang `mint-sched` LIVE untuk stage allowlist/WL/OG yang eligible dan stage publik yang akan datang; mint langsung stage yang sudah buka. |
| `drop-mint.mjs` | Mint langsung satu stage yang sudah buka (allowlist atau public). Simulasi dulu, cek saldo + pending nonce, baru kirim. |
| `mint-core.mjs` | Logika mint bersama: `prepare()` (ambil stage + proof / data public), `check()` (cek `getMintStats` on-chain), `holdMint()` (catat kontrak ke `hold-mint.json`), exit codes. |
| `mint-sched.mjs` | Presign sniper: tidur sampai T-5 detik, sign tx, pantau block tiap 100 ms, broadcast di block pertama `ts >= start`, re-sign kalau nonce berubah. |
| `lpkit.mjs` | Kit viem bersama: `pub` (public client) + `acct` (wallet dari `KALOS_PRIVATE_KEY`). Juga berisi helper LP/swap dari farm utama — script mint **hanya** memakai `pub`/`acct`. |
| `retry-mint-loop.sh` | Loop retry ~10 detik untuk SATU stage sampai sukses/terminal/window tutup. Satu proses background, tanpa agent per percobaan. |
| `punks-watchdog.sh` | Contoh watchdog: awasi presign + retry loop untuk stage-stage yang masih armed, pasang ulang kalau mati. **Stage + window di-hardcode di bawah file — sesuaikan per drop.** |
| `outlaws-mint.mjs` | One-off / referensi: mint saat data eligibility API usang (bangun `mintParams` dari waktu stage di objek drop + proof live). Lihat §7. |
| `outlaws-retry-loop.sh` | One-off: tick cron untuk outlaws (6 percobaan @10 detik per tick, done-marker). Referensi pola retry cron-driven. |
| `package.json` | `viem ^2`, `"type": "module"`. |
| `.env.example` | Template env (tanpa nilai asli). |
| `.gitignore` | `node_modules/`, `.env`, `*.log`, state file runtime. |

File runtime (dibuat otomatis saat jalan, **jangan** di-commit):
`drop-scan.log`, `drop-sched.log`, `<slug>-retry.log`, `drop-scan-seen.json`,
`hold-mint.json`, `outlaws-retry-done.txt`.

---

## 3. Cara kerja pipeline

```
setiap jam:  drop-scan.mjs
  ├─ GET /v2/launch/drops  (+ eligibility per drop untuk wallet kamu)
  ├─ stage allowlist/WL/OG eligible & AKAN DATANG  → spawn mint-sched LIVE (presign)
  ├─ stage publik & AKAN DATANG                    → spawn mint-sched LIVE (presign, tanpa proof)
  ├─ stage eligible/publik & SUDAH BUKA            → drop-mint langsung (LIVE=1)
  └─ catat slug yang pernah dilihat di drop-scan-seen.json

mendekati buka:  mint-sched.mjs <slug> <stage>
  ├─ tidur sampai T-5 detik → prepare + check + SIGN tx (lokal, belum broadcast)
  ├─ pantau block tiap 100 ms; re-sign kalau nonce berubah
  ├─ block pertama ts >= start → broadcast raw tx 2x → tunggu receipt → RESULT
  └─ tiap 5 detik setelah sign: re-check terminal (DONE/SOLD OUT/STAGE FULL) → STOP

cadangan:  retry-mint-loop.sh <slug> <stage> <open> <end> [grace=120] [mode]
  └─ tidur sampai open+grace (beri presign kesempatan duluan), lalu drop-mint tiap ~10 detik
     sampai sukses atau terminal. Satu proses, flock single-instance per slug+stage.

pengawas:  punks-watchdog.sh  (cron tiap 5 menit)
  └─ kalau presign/loop satu stage mati padahal stage belum beres & window belum tutup → pasang ulang.
```

### Aturan mint (kebijakan yang diimplementasikan)

- **Mint max** selama check lolos: bukan DONE / SOLD OUT / STAGE FULL / ENDED, simulasi lolos,
  saldo bebas ≥ 1 HYPE. Jumlah = `maxPerWallet − sudahMint` (dibatasi sisa supply & stage cap).
- **Stage publik ikut di-mint** sama seperti allowlist (tanpa proof, harga dari objek `public` drop).
- **Gagal non-terminal WAJIB dicoba lagi**: di-run yang sama, scan jam berikut, dan loop 10 detik.
  Berhenti hanya pada terminal (DONE / SOLD OUT / STAGE FULL) — ketiganya harus dilaporkan.
- **`daimons` dikecualikan** dari auto-scheduling (hardcode `continue` di drop-scan + exit 9 di drop-mint).
- **Tidak ada mint manual.** Semua mint dikerjakan agent/script; laporan hanya status.

### Exit code `drop-mint.mjs`

| Code | Arti | Aksi |
|---|---|---|
| 0 | OK (mint sukses) | berhenti |
| 1 | sim revert / kirim gagal | **retry** |
| 2 | belum buka (chain ts) | **retry** nanti |
| 3 | ada tx pending (nonce) | **retry** nanti |
| 5 | saldo bebas < 1 HYPE | **retry** (setelah top-up) |
| 6 | tidak eligible | terminal — jangan retry |
| 7 | stage sudah ended | terminal |
| 8 | DONE (sudah mint max) | terminal |
| 9 | excluded (daimons) | terminal |
| 10 | mode tidak dikenal | terminal (bug pemanggil) |
| 11 | STAGE FULL | terminal |
| 12 | SOLD OUT | terminal |

`retry-mint-loop.sh` berhenti pada 0, 6, 7, 8, 9, 10, 11, 12 dan menulis
`RETRY-TERMINAL code=N` ke `<slug>-retry.log`.

---

## 4. Konsep penting (yang sering bikin salah)

### 4.1 Counter SeaDrop per-wallet itu SHARED antar stage

`mint-core.check()` memanggil `getMintStats(wallet)` pada **kontrak NFT** (bukan kontrak SeaDrop —
panggilan ke SeaDrop revert). Return: `(minted, totalSupply, maxSupply)` dengan `minted` =
**total mint wallet itu untuk NFT tersebut di semua stage**. Jadi:

```
want = maxPerWallet − minted
```

Kalau wallet sudah mint 1/1 di Allowlist, stage public dengan maxPerWallet 1 akan
terbaca DONE — walau supply public masih banyak. Ini **bukan bug**, ini cara kerja SeaDrop.
Contoh nyata: hypaww — Allowlist mint 1/1, public max 1 → public DONE, jangan pasang presign.

### 4.2 Stage publik vs allowlist

- **Allowlist/WL/OG:** butuh `proof` dari endpoint eligibility
  (`/v2/launch/drops/{slug}/eligibility/{address}`), mint via `mintAllowList`
  dengan `mintParams` + proof.
- **Public:** tanpa proof, mint via `mintPublic`, harga dari `drop.public.priceWei`,
  jumlah sampai `drop.public.maxPerWallet`.
- SeaDrop address bisa beda per drop — selalu pakai `D.seaDrop` dari objek drop,
  jangan hardcode satu SeaDrop untuk semua.

### 4.3 Eligibility bisa usang (stale-eligibility trap)

Entry eligibility (`mintParams`) pernah membawa **waktu usang** sementara objek drop
dan chain punya waktu yang benar (kasus outlaws, Nov 2026: eligibility bilang stage
sudah ended, padahal window asli baru buka — semua sim revert sampai API diperbaiki
server-side ~35 menit kemudian). Pelajaran:

- Selalu cross-check **waktu stage di objek drop** vs **waktu di eligibility entry**.
  Kalau tidak cocok, curigai data API-nya, bukan script-nya.
- `outlaws-mint.mjs` adalah pola daruratnya: bangun `mintParams` dari waktu stage
  objek drop + proof live.
- Jangan simpulkan "script rusak" dari sim revert berulang kalau API-nya yang salah.

### 4.4 Presign bisa mati tanpa jejak

Proses `mint-sched` / retry loop yang diluncurkan worker bisa mati tanpa log
(teramati berulang: kemungkinan VM/deployment mengganti mesin). Karena itu ada
**tiga lapis**: presign + retry loop 10 detik + watchdog 5 menit + scan per jam.
Satu lapis mati tidak boleh berarti mint hilang. Selalu verifikasi `ps` sebelum
me-relaunch presign (duplikat presign = risiko double-broadcast).

### 4.5 Waktu sign: T-5 detik

`mint-sched` sign di **T-5 detik** (bukan T-60): nonce lebih segar, tapi slack lebih tipis
kalau RPC lambat saat sign. Poll block 100 ms menjelang buka; re-sign kalau nonce berubah.
Untuk drop yang sold-out dalam hitungan menit, presign first-block adalah satu-satunya
peluang nyata — retry loop saja tidak cukup.

### 4.6 Gas & harga

- `drop-mint`: `estimateGas × 1.4`, `gasPrice × 1.5`.
- `mint-sched`: gas tetap 350000, `gasPrice × 2` (kejar first-block).
- Transaksi bertipe **legacy** (`type: 'legacy'`).
- Harga mint bisa beda antara objek drop dan eligibility entry (kasus catto: 0.05 vs 0.5 —
  10x). Kalau ragu, jangan tebak: cek harga on-chain / tunggu sim. **Catatan:** path live
  `mint-sched` **tidak** pre-simulate sebelum broadcast (risiko gas revert hanya pada
  percobaan first-block); `drop-mint` dan mode presign `outlaws-mint` selalu sim dulu.

---

## 5. Cron yang disarankan

Semua cron jalan dengan env yang sama (`KALOS_PRIVATE_KEY`, `KALOS_RPC`,
`KALOS_WALLET_ADDRESS` bila beda dari default). Zona waktu `Asia/Makassar`.

```cron
# Scan drop + auto-mint, tiap jam (menit bebas, contoh :34)
34 * * * *  cd /path/kalos-nft-mint && KALOS_PRIVATE_KEY="$KALOS_PRIVATE_KEY" KALOS_RPC="$KALOS_RPC" node drop-scan.mjs >> drop-scan.log 2>&1

# Watchdog presign + retry loop, tiap 5 menit (sesuaikan daftar stage di punks-watchdog.sh dulu!)
*/5 * * * * cd /path/kalos-nft-mint && KALOS_PRIVATE_KEY="$KALOS_PRIVATE_KEY" KALOS_RPC="$KALOS_RPC" bash punks-watchdog.sh >> drop-sched.log 2>&1
```

> Simpan secret di file env yang hanya dibaca cron (mode 0600), **jangan** tulis langsung
> di crontab. Contoh: `set -a; source /path/.env.mint; set +a` di awal tiap job, atau
> bungkus dengan script launcher kecil.

---

## 6. Troubleshooting

| Gejala | Diagnosis | Perbaikan |
|---|---|---|
| `drop-scan` keluar 0 tapi tidak ada presign | Stage belum eligible / sudah lewat / `daimons` / `AUTOSCHED=0` / key tidak ter-export | Cek output JSON scan + `drop-scan.log`; pastikan `KALOS_PRIVATE_KEY` ter-set |
| `invalid private key` di semua direct mint | Key terambil salah (file wallet JSON bentuknya `{"skyzee": {"privateKey": ...}}` — ambil `.skyzee.privateKey`, bukan seluruh record) | Perbaiki ekstraksi key; jangan pernah print key-nya |
| Sim revert terus untuk satu stage | Bisa jadi API usang (§4.3) atau proof invalid | Cross-check waktu drop vs eligibility; coba `outlaws-mint.mjs` sebagai pola; jangan paksa kirim tanpa sim lolos |
| Presign mati sebelum buka | VM/deployment restart | Watchdog 5 menit + scan per jam akan pasang ulang; verifikasi `ps` + `drop-sched.log` |
| `api-marketplace-mismatch` / snapshot tanpa field marketplace | API Kalos kadang mengembalikan snapshot kosong/parsial (transient) | Retry — biasanya pulih dalam hitungan detik/menit. Bukan ganti market kalau registryVersion tetap sama |
| RPC 429 / timeout / 403 | Public RPC Kinetiq rate-limit | Pakai Alchemy RPC (`KALOS_RPC`); `J()` di mint-core sudah retry 6x |
| `pending tx` (exit 3) | Nonce pending belum mined | Tunggu; jangan kirim duplikat dengan nonce sama |
| Mint sukses tapi token tidak tercatat locked | `holdMint()` gagal tulis (permission/path) | Cek `hold-mint.json` bisa ditulis; tambahkan manual alamat kontrak (lowercase) |
| Dua presign untuk stage yang sama | Relaunch tanpa cek `ps` dulu | Bunuh duplikat, sisakan satu; `pgrep -f "mint-sched.mjs <slug> <stage>"` |

---

## 7. Kasus one-off: outlaws (referensi)

`outlaws-mint.mjs` + `outlaws-retry-loop.sh` dipertahankan sebagai **referensi pola darurat**,
bukan bagian pipeline utama:

- Masalah: eligibility entry outlaws membawa waktu usang (2 Nov) + proof 11 elemen,
  sementara window asli 4 Nov 22:00–23:30 WITA dengan proof 12 elemen. Pipeline standar
  menganggap stage ended → skip. Sim selalu revert (benar — data API salah, bukan script).
- Solusi: bangun `mintParams` dari **waktu stage objek drop** + proof live dari eligibility.
- Mode: `NO_WAIT=1` (exit 2 kalau belum buka, untuk retry via scan), `PRESIGN=1`
  (sign T-60, sim sekali di block buka sebelum broadcast), `PRESIGN_SIGN_TEST=1`
  (test sign tanpa broadcast), `FAST=1` (sim 1x, tanpa retry 30 detik).
- Akhir: user mint manual (tx `0x05ef...`), wallet max 1/1, supply 666/666 sold out.
  Pelajaran ini yang melahirkan aturan cross-check §4.3 dan loop 10 detik §3.

---

## 8. Kontrak & endpoint (Elysium testnet, chainId 99801)

| Item | Nilai |
|---|---|
| Drops API | `GET https://api.kalos.fun/v2/launch/drops` |
| Eligibility API | `GET https://api.kalos.fun/v2/launch/drops/{slug}/eligibility/{address}` |
| Market (baru, sejak 3 Nov 2026) | `0x6A55367680F86755C8614e49de823bA26Fd370a0` |
| WHYPE (market + DEX) | `0xCD57F65c2B0e5881CFC2E609F7CD53b746E1F234` |
| SeaDrop (farm const; per-drop bisa beda) | `0x48c54fEE271Cd22e4fCB2E7b49aB83be35C97B5B` |
| RPC public | `https://testnet-rpc.elysium.kinetiq.xyz` |
| RPC Alchemy (disarankan) | `https://elysium-testnet.g.alchemy.com/v2/<key>` |

Fungsi SeaDrop yang dipakai: `mintAllowList(address,address,address,uint256,(...mintParams...),bytes32[])`,
`mintPublic(address,address,address,uint256)`. Cek kuota: `getMintStats(address)` pada
**kontrak NFT** → `(minted, totalSupply, maxSupply)`.

---

## 9. Riwayat singkat (kenapa kode ini bentuknya begini)

- **4 Nov 2026:** scan per jam + auto-mint dibuat; presign wajib untuk tiap drop baru;
  retry sampai berhasil (terminal wajib lapor); tanpa manual; stage publik ikut mint;
  "kalau masih bisa ya mint" (gate baru-only dicabut).
- **5 Nov 2026 04:00:** catto — presign mati sebelum buka, user mint manual 2/2.
  Lahir: watchdog 5 menit + sign T-5 detik + retry loop 10 detik sebagai proses mandiri.
- **5 Nov 2026 05:00:** the-obol Allowlist ke-mint presign first-block 05:00:01 — bukti
  pipeline bekerja kalau semua lapis hidup.
- **5 Nov 2026 18:35 / 20:00:** hypaww Allowlist + mori WL ke-mint (langsung / presign).
- **6 Nov 2026 00:59:59:** elysium-punks Allowlist 5/5 via presign; public-nya terminal
  DONE 03:01 (counter shared + supply habis) — sesuai prediksi §4.1.
- **6 Nov 2026 05:00:57:** the-obol public terminal DONE (wallet 1/1 + supply 500/500).

Semua token hasil mint tercatat di `hold-mint.json` dan **tidak boleh dijual**.

---

## Lisensi

Kode ini milik Skyzee, dipakai untuk farming Kalos di Elysium testnet. Pakai dan ubah
bebas untuk keperluan sendiri; jangan kirim private key ke mana pun — repo ini tidak
pernah meminta key lewat chat, file, atau form apa pun.
