"""Membaca status pipeline dari GraphQL Dagster dan meluncurkan job lewat `dagster job launch` (antrean daemon)."""
from __future__ import annotations

import json
import os
import subprocess
import urllib.error
import urllib.request

from . import pengaturan

JOB = {
    "pipeline_penuh": "Semua sumber sampai peringatan (biasanya Senin 05.00).",
    "pipeline_harga_harian": "Harga terbaru, K3, status, dan peringatan (06.00 dan 14.00).",
    "pipeline_citra": "Citra Sentinel terbaru, K1, K2, SPHP, status, dan peringatan.",
}

Q_RINGKASAN = """
query {
  assetNodes { assetKey { path } groupName description computeKind jobNames
    assetChecksOrError { __typename ... on AssetChecks { checks { name description
      executionForLatestMaterialization { status runId timestamp evaluation { severity description } } } } } }
  runsOrError(limit: 60) {
    __typename
    ... on Runs { results { runId status jobName startTime endTime tags { key value }
                          stepStats { stepKey status startTime endTime } } }
    ... on PythonError { message }
  }
  instance { daemonHealth { allDaemonStatuses { daemonType healthy required lastHeartbeatTime } } }
}"""

Q_MATERIALISASI = """
query($keys: [AssetKeyInput!]!) {
  assetsLatestInfo(assetKeys: $keys) { assetKey { path } latestMaterialization { timestamp runId } inProgressRunIds unstartedRunIds }
}"""

Q_LOG = """
query($id: ID!, $after: String) {
  runOrError(runId: $id) { __typename ... on Run { runId status jobName startTime endTime tags { key value } } }
  logsForRun(runId: $id, afterCursor: $after, limit: 2000) {
    __typename
    ... on EventConnection { cursor hasMore events {
      __typename
      ... on MessageEvent { message timestamp level stepKey }
      ... on ExecutionStepFailureEvent { error { message stack causes { message stack } } }
      ... on RunFailureEvent { error { message stack } }
      ... on EngineEvent { error { message stack } }
    } }
    ... on PythonError { message }
  }
}"""


class GalatDagster(RuntimeError):
    pass


def graphql(query: str, variabel: dict | None = None, batas_waktu: float = 20) -> dict:
    data = json.dumps({"query": query, "variables": variabel or {}}).encode()
    req = urllib.request.Request(pengaturan.DAGSTER_GRAPHQL, data=data, headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=batas_waktu) as r:
            hasil = json.loads(r.read())
    except urllib.error.HTTPError as e:  # GraphQL mengirim 400 untuk query salah, isinya tetap JSON
        try:
            hasil = json.loads(e.read())
        except ValueError:
            raise GalatDagster(f"Dagster menjawab HTTP {e.code}.") from None
    except OSError as e:
        raise GalatDagster(f"Dagster tidak bisa dihubungi ({e.__class__.__name__}). Webserver mungkin mati; cek deploy/dagster-webserver.log.") from None
    if hasil.get("errors"):
        raise GalatDagster("; ".join(e.get("message", "") for e in hasil["errors"])[:500])
    return hasil["data"]


def _cek(aset: dict) -> list[dict]:
    """Asset check (mis. konektor sumber gagal = peringatan, aset tetap jalan memakai data cadangan)."""
    hasil = []
    co = aset.get("assetChecksOrError") or {}
    for c in co.get("checks", []) if co.get("__typename") == "AssetChecks" else []:
        e = c.get("executionForLatestMaterialization") or {}
        ev = e.get("evaluation") or {}
        hasil.append({"nama": c["name"], "ket": c.get("description"), "status": e.get("status"), "keparahan": ev.get("severity"),
                      "pesan": ev.get("description"), "runId": e.get("runId"), "waktu": e.get("timestamp")})
    return hasil


def ringkasan() -> dict:
    d = graphql(Q_RINGKASAN)
    runs_or = d["runsOrError"]
    if runs_or["__typename"] != "Runs":
        raise GalatDagster(runs_or.get("message", "gagal membaca run"))
    runs = runs_or["results"]
    aset = d["assetNodes"]
    kunci = [{"path": a["assetKey"]["path"]} for a in aset]
    mat = {"/".join(i["assetKey"]["path"]): i for i in graphql(Q_MATERIALISASI, {"keys": kunci})["assetsLatestInfo"]} if kunci else {}

    # Status per aset = status langkah (step) aset itu di run terbaru yang menjalankannya.
    langkah_terakhir: dict[str, dict] = {}
    for r in runs:  # terbaru dulu
        for s in r["stepStats"]:
            if s["stepKey"] not in langkah_terakhir:
                langkah_terakhir[s["stepKey"]] = {**s, "runId": r["runId"], "jobName": r["jobName"]}

    hasil_aset = []
    for a in aset:
        nama = "/".join(a["assetKey"]["path"])
        m = mat.get(nama, {})
        lm = m.get("latestMaterialization") or {}
        lk = langkah_terakhir.get(a["assetKey"]["path"][-1])
        status = lk["status"] if lk else None
        if m.get("inProgressRunIds"):
            status = "IN_PROGRESS"
        hasil_aset.append({
            "nama": nama, "grup": a["groupName"], "ket": a["description"], "jenis": a.get("computeKind"),
            "status": status, "antre": bool(m.get("unstartedRunIds")), "runId": lk["runId"] if lk else None, "mulai": lk["startTime"] if lk else None,
            "selesai": lk["endTime"] if lk else None,
            "cek": _cek(a),
            "materialisasi": float(lm["timestamp"]) / 1000 if lm.get("timestamp") else None, "runMaterialisasi": lm.get("runId"),
        })

    daftar_run = []
    for r in runs[:40]:
        tag = {t["key"]: t["value"] for t in r["tags"]}
        gagal = [s["stepKey"] for s in r["stepStats"] if s["status"] == "FAILURE"]
        daftar_run.append({
            "runId": r["runId"], "status": r["status"], "job": r["jobName"], "mulai": r["startTime"], "selesai": r["endTime"],
            "pemicu": tag.get("dagster/schedule_name") or tag.get("dagster/sensor_name") or tag.get("diluncurkan_oleh") and f"admin ({tag['diluncurkan_oleh']})" or "manual",
            "alasanGagal": tag.get("dagster/failure_reason"), "langkahGagal": gagal, "jumlahLangkah": len(r["stepStats"]),
        })
    daemon = [{"jenis": x["daemonType"], "sehat": x["healthy"], "wajib": x["required"], "detak": x["lastHeartbeatTime"]}
              for x in d["instance"]["daemonHealth"]["allDaemonStatuses"] if x["required"]]
    return {"aset": hasil_aset, "run": daftar_run, "daemon": daemon, "job": JOB}


def log_run(run_id: str) -> dict:
    events, cursor, run = [], None, None
    for _ in range(5):  # maks 10.000 event
        d = graphql(Q_LOG, {"id": run_id, "after": cursor})
        if d["runOrError"]["__typename"] != "Run":
            raise GalatDagster("Run tidak ditemukan.")
        run = d["runOrError"]
        lg = d["logsForRun"]
        if lg["__typename"] != "EventConnection":
            raise GalatDagster(lg.get("message", "gagal membaca log"))
        for e in lg["events"]:
            err = e.get("error")
            events.append({
                "jenis": e["__typename"], "waktu": float(e["timestamp"]) / 1000 if e.get("timestamp") else None,
                "level": e.get("level"), "langkah": e.get("stepKey"), "pesan": e.get("message"),
                "galat": {"pesan": err["message"], "jejak": "".join(err.get("stack") or []),
                          "sebab": [c["message"] for c in err.get("causes") or []]} if err else None,
            })
        cursor = lg["cursor"]
        if not lg["hasMore"]:
            break
    return {"run": run, "event": events}


def run_berjalan() -> list[str]:
    d = graphql('query { runsOrError(filter: {statuses: [STARTED, STARTING, CANCELING]}) { ... on Runs { results { runId jobName } } } }')
    return [r["jobName"] for r in d["runsOrError"].get("results", [])]


def luncurkan(job: str, pengguna: str) -> str:
    """Masukkan run ke antrean (QueuedRunCoordinator); daemon yang menjalankannya, sama seperti jadwal."""
    if job not in JOB:
        raise GalatDagster("Job tidak dikenal.")
    dagster = pengaturan.VENV_PIPELINE / "bin/dagster"
    env = {**os.environ, "DAGSTER_HOME": pengaturan.DAGSTER_HOME}
    hasil = subprocess.run([str(dagster), "job", "launch", "-m", "terawang_pipeline.definitions", "-j", job,
                            "--tags", json.dumps({"diluncurkan_oleh": pengguna})],
                           cwd=pengaturan.REPO / "pipeline", env=env, capture_output=True, text=True, timeout=180)
    if hasil.returncode != 0:
        raise GalatDagster("Gagal meluncurkan job:\n" + (hasil.stdout + hasil.stderr)[-1500:])
    return "Run masuk antrean; daemon Dagster akan menjalankannya dalam beberapa detik."


def mulai_ulang_pipeline() -> str:
    """Muat ulang webserver dan daemon Dagster supaya pipeline/.env yang baru terbaca."""
    berjalan = run_berjalan()
    if berjalan:
        raise GalatDagster(f"Ada run yang sedang berjalan ({', '.join(berjalan)}). Tunggu selesai dulu supaya tidak terputus.")
    jaga = pengaturan.REPO / "deploy/pipeline-ensure.sh"
    if not jaga.exists():
        raise GalatDagster("deploy/pipeline-ensure.sh tidak ada; jalankan deploy-pipeline.sh dulu.")
    # pola [d]agster supaya pkill tidak ikut membunuh shell yang menjalankan perintah ini
    perintah = ('pkill -f "[d]agster-webserver -m terawang_pipeline.definitions" ; pkill -f "[d]agster-daemon run -m terawang_pipeline.definitions" ; '
                # tunggu proses lama (termasuk code server) benar-benar berhenti, maks 90 detik, baru nyalakan lagi
                'for i in $(seq 1 90); do pgrep -f "[d]agster-(webserver|daemon) .*terawang_pipeline.definitions" >/dev/null || break; sleep 1; done ; '
                'pkill -9 -f "[d]agster-(webserver|daemon) .*terawang_pipeline.definitions" ; '
                f'bash "{jaga}" --paksa')
    subprocess.Popen(["bash", "-c", perintah], start_new_session=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    return "Dagster sedang dimuat ulang (menunggu proses lama berhenti, bisa sampai 90 detik). Status kembali setelah itu."


def mulai_ulang_bot() -> str:
    hasil = subprocess.run(["docker", "compose", "up", "-d", "--no-build", "--force-recreate"], cwd=pengaturan.BOT_DIR,
                           capture_output=True, text=True, timeout=180)
    if hasil.returncode != 0:
        raise GalatDagster("Gagal menyalakan ulang bot:\n" + (hasil.stdout + hasil.stderr)[-1500:])
    return "Container terawang-bot dibuat ulang dengan .env baru."
