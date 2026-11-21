-- Role Postgres khusus bot: baca data model, tulis hanya tabel kanal warga.
-- Jalankan sebagai superuser:  psql -v pw="'...'" -f role-bot.sql terawang
create role terawang_bot login password :pw;
grant connect on database terawang to terawang_bot;
grant usage on schema ref, silver, app to terawang_bot;

grant select on ref.wilayah, ref.komoditas to terawang_bot;
grant select on silver.harga_kabkota_harian, silver.jarak_antar_wilayah to terawang_bot;
grant select on app.model_run, app.status_wilayah, app.prediksi_harga, app.estimasi_stok,
                app.rekomendasi_sphp, app.peringatan, app.ambang_harga to terawang_bot;

grant select, insert, update on app.kontak_warga, app.langganan_peringatan, app.notifikasi,
                               app.laporan_harga_warga to terawang_bot;
grant select, insert on app.percakapan_bot to terawang_bot;
grant usage on sequence app.kontak_warga_id_seq, app.langganan_peringatan_id_seq, app.notifikasi_id_seq,
                        app.percakapan_bot_id_seq, app.laporan_harga_warga_id_seq to terawang_bot;
