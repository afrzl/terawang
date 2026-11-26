#!/usr/bin/env python3
"""Server statis untuk hasil build (dist/) dengan fallback SPA.

Rute seperti /stok atau /harga tidak ada sebagai file, jadi dikembalikan ke
index.html dan React Router yang menampilkan halamannya.

Permintaan /api/* diteruskan ke API backend (API_UPSTREAM, bawaan http://172.19.0.1:3072), sebagai cadangan bila
router Traefik khusus /api (deploy/traefik-api.yml) belum terpasang.

Pemakaian: python3 deploy/serve.py --dir dist --port 8080
"""
import argparse
import functools
import http.server
import os
import urllib.error
import urllib.request

API_UPSTREAM = os.environ.get("API_UPSTREAM", "http://172.19.0.1:3072").rstrip("/")
TERUSKAN = ("Content-Type", "Cache-Control", "Vary", "Set-Cookie")


class SPAHandler(http.server.SimpleHTTPRequestHandler):
    def do_GET(self):
        if self.path == "/api" or self.path.startswith("/api/"):
            return self.proksi_api()
        return super().do_GET()

    def proksi_api(self):
        kepala = {k: v for k, v in self.headers.items() if k.lower() in ("cookie", "accept", "user-agent")}
        req = urllib.request.Request(API_UPSTREAM + self.path, headers=kepala)
        try:
            with urllib.request.urlopen(req, timeout=20) as r:
                status, hdr, isi = r.status, r.headers, r.read()
        except urllib.error.HTTPError as e:
            status, hdr, isi = e.code, e.headers, e.read()
        except Exception:  # noqa: BLE001 - API mati: balas JSON supaya dasbor jatuh ke data cadangan
            status, hdr, isi = 502, {"Content-Type": "application/json"}, b'{"galat":"API tidak terjangkau"}'
        self.send_response(status)
        for k in TERUSKAN:
            for v in (hdr.get_all(k) if hasattr(hdr, "get_all") else [hdr.get(k)]) or []:
                if v:
                    self.send_header(k, v)
        self.send_header("Content-Length", str(len(isi)))
        super(http.server.SimpleHTTPRequestHandler, self).end_headers()
        self.wfile.write(isi)

    def send_head(self):
        path = self.translate_path(self.path)
        # Hanya rute tanpa ekstensi yang dialihkan; aset yang hilang tetap 404.
        if not os.path.exists(path) and not os.path.splitext(self.path.split("?")[0])[1]:
            self.path = "/index.html"
        return super().send_head()

    def end_headers(self):
        # Aset ber-hash boleh di-cache lama; index.html selalu dicek ulang.
        if self.path.startswith("/assets/"):
            self.send_header("Cache-Control", "public, max-age=31536000, immutable")
        else:
            self.send_header("Cache-Control", "no-cache")
        super().end_headers()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dir", default="dist")
    ap.add_argument("--port", type=int, default=8080)
    ap.add_argument("--bind", default="0.0.0.0")
    a = ap.parse_args()
    handler = functools.partial(SPAHandler, directory=os.path.abspath(a.dir))
    with http.server.ThreadingHTTPServer((a.bind, a.port), handler) as srv:
        print(f"TERAWANG disajikan di http://{a.bind}:{a.port} dari {a.dir}", flush=True)
        srv.serve_forever()


if __name__ == "__main__":
    main()
