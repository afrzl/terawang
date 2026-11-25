"""Pembantu menulis ke schema app: membuka dan menutup app.model_run, menyisipkan DataFrame."""

import json
from contextlib import contextmanager
from datetime import datetime
from zoneinfo import ZoneInfo

import pandas as pd
import sqlalchemy as sa

from ..resources import Database

WIB = ZoneInfo("Asia/Jakarta")


def sekarang() -> datetime:
    return datetime.now(WIB)


@contextmanager
def model_run(db: Database, jenis: str, versi: str, parameter: dict | None = None):
    """Catat satu baris app.model_run (BERJALAN -> SELESAI/GAGAL). Yield (id, dict metrik yang boleh diisi)."""
    eng = db.engine()
    with eng.begin() as c:
        rid = c.execute(
            sa.text("insert into app.model_run (jenis, nama_versi, parameter, status) values (:j, :v, cast(:p as jsonb), 'BERJALAN') returning id"),
            {"j": jenis, "v": versi, "p": json.dumps(parameter or {}, default=str)},
        ).scalar_one()
    metrik: dict = {}
    try:
        yield rid, metrik
    except Exception:
        with eng.begin() as c:
            c.execute(sa.text("update app.model_run set status='GAGAL', selesai_pada=now() where id=:i"), {"i": rid})
        raise
    with eng.begin() as c:
        c.execute(
            sa.text("update app.model_run set status='SELESAI', selesai_pada=now(), metrik=cast(:m as jsonb) where id=:i"),
            {"i": rid, "m": json.dumps(metrik, default=str)},
        )


def sisipkan(db: Database, tabel: str, df: pd.DataFrame) -> int:
    if df.empty:
        return 0
    schema, nama = tabel.split(".")
    with db.engine().begin() as c:
        df.to_sql(nama, c, schema=schema, if_exists="append", index=False, method="multi", chunksize=2000)
    return len(df)
