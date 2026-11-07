#!/usr/bin/env python3
"""Server statis untuk hasil build (dist/) dengan fallback SPA.

Rute seperti /stok atau /harga tidak ada sebagai file, jadi dikembalikan ke
index.html dan React Router yang menampilkan halamannya.

Pemakaian: python3 deploy/serve.py --dir dist --port 8080
"""
import argparse
import functools
import http.server
import os


class SPAHandler(http.server.SimpleHTTPRequestHandler):
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
