// 验证服务端 PUT /api/store 修复：空 books + 污染 tomb 不再清空书库；正常删除仍生效。
const BASE = "http://localhost:3099";

function wait(ms) { return new Promise(r => setTimeout(r, ms)); }

async function waitReady() {
  for (let i = 0; i < 50; i++) {
    try {
      const r = await fetch(BASE + "/api/state");
      if (r.ok) return true;
    } catch (e) { /* not ready */ }
    await wait(200);
  }
  throw new Error("测试服务未就绪");
}

async function getState() {
  const r = await fetch(BASE + "/api/state");
  return r.json();
}

async function putStore(body) {
  const r = await fetch(BASE + "/api/store", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  return r.json();
}

async function delBook(id) {
  const r = await fetch(BASE + "/api/books/" + encodeURIComponent(id), { method: "DELETE" });
  return r.json();
}

(async () => {
  await waitReady();
  const before = await getState();
  console.log("[初始] books:", before.books.length, "ids:", before.books.map(b => b.id).join(","));

  // 构造「致命载荷」：空 books + 把 3 本正常书的 id 全塞进 deletedBookIds
  const badTomb = before.books.map(b => b.id);
  const badPayload = { books: [], deletedBookIds: badTomb, kb: before.kb };
  await putStore(badPayload);
  const afterBad = await getState();
  console.log("[推送空 books+污染tomb 后] books:", afterBad.books.length,
    afterBad.books.length === before.books.length ? "✅ 未删除（修复生效）" : "❌ 被清空（修复失败）");

  // 再测一次「未携带 books 字段」（仅同步笔记）也不该删书
  await putStore({ kb: before.kb, deletedBookIds: badTomb });
  const afterNoBooks = await getState();
  console.log("[未携带 books 字段 推送后] books:", afterNoBooks.books.length,
    afterNoBooks.books.length === before.books.length ? "✅ 未删除" : "❌ 被清空");

  // 正常删除流程：DELETE 一本书应真正删掉
  const delTarget = before.books[0].id;
  await delBook(delTarget);
  const afterDel = await getState();
  console.log("[DELETE 一本后] books:", afterDel.books.length,
    afterDel.books.length === before.books.length - 1 ? "✅ 正常删除生效" : "❌ 删除异常");
  console.log("  剩余 ids:", afterDel.books.map(b => b.id).join(","));

  const ok = afterBad.books.length === before.books.length &&
             afterNoBooks.books.length === before.books.length &&
             afterDel.books.length === before.books.length - 1;
  console.log(ok ? "\n=== 全部通过 ✅ ===" : "\n=== 存在失败 ❌ ===");
  process.exit(ok ? 0 : 1);
})().catch(e => { console.error("测试错误:", e.message); process.exit(2); });
