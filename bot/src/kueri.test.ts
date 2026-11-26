import assert from "node:assert/strict"
import { test } from "node:test"
import { periksaSql } from "./kueri.ts"

test("hanya satu SELECT yang lolos", () => {
  assert.equal(periksaSql("select nama from ref.wilayah"), null)
  assert.equal(periksaSql("with x as (select 1) select * from x;"), null)
  assert.ok(periksaSql("delete from app.peringatan"))
  assert.ok(periksaSql("select 1; drop table x"))
  assert.ok(periksaSql("select pg_sleep(10)"))
  assert.ok(periksaSql("select * from ref.wilayah -- komentar"))
  assert.equal(periksaSql("select * from ref.wilayah where nama = 'set'"), null)
})
