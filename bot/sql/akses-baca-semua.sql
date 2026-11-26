-- Akses baca-saja bot ke seluruh data TERAWANG (permintaan pemilik, 27 Nov 2026).
-- Role terpisah terawang_bot_baca dipakai alat kueri_data lewat SET LOCAL ROLE di transaksi READ ONLY,
-- jadi kueri bebas dari OpenAI tidak bisa menulis dan tidak bisa membaca data pribadi warga/akun.
-- Jalankan sebagai superuser: docker exec -i postgres-postgres-1 psql -U postgres -d terawang < sql/akses-baca-semua.sql

do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'terawang_bot_baca') then
    create role terawang_bot_baca nologin;
  end if;
end $$;

do $$
declare s text;
begin
  foreach s in array array['ref', 'silver', 'gold', 'bronze', 'app'] loop
    if exists (select 1 from information_schema.schemata where schema_name = s) then
      execute format('grant usage on schema %I to terawang_bot_baca, terawang_bot', s);
      execute format('grant select on all tables in schema %I to terawang_bot_baca', s);
      execute format('alter default privileges in schema %I grant select on tables to terawang_bot_baca', s);
    end if;
  end loop;
end $$;

-- data pribadi warga dan akun tidak boleh terbaca lewat kueri bebas
revoke select on app.kontak_warga, app.percakapan_bot, app.langganan_peringatan, app.notifikasi,
  app.laporan_harga_warga, app.organisasi, app.pengguna, app.wilayah_pantauan, app.langganan,
  app.paket_langganan, app.parameter_sistem from terawang_bot_baca;

grant terawang_bot_baca to terawang_bot;

-- alat khusus produksi_wilayah memakai role bot langsung
grant select on silver.produksi_padi, app.prediksi_produksi to terawang_bot;
