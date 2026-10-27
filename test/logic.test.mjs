import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as L from '../logic.js';

test('書いた言葉はそのまま入る（日付やタグに読み替えない）', () => {
  assert.deepEqual(L.parseLine('明日 歯医者に電話'), { title: '明日 歯医者に電話', url: '' });
  assert.equal(L.parseLine('  企画書を金曜までに出す #仕事  ').title, '企画書を金曜までに出す #仕事');
});

test('リンクは取り出して押せるようにする', () => {
  const u = L.parseLine('この記事を読む https://example.com/a/b?x=1');
  assert.equal(u.title, 'この記事を読む');
  assert.equal(u.url, 'https://example.com/a/b?x=1');
  assert.deepEqual(L.parseLine('https://example.com/post'), { title: 'example.com/post', url: 'https://example.com/post' });
  assert.equal(L.parseLine('javascript:alert(1) を調べる').url, '');
  assert.equal(L.parseLine('https://example.com/x を読む').title, 'example.com/x を読む', '「を読む」だけにしない');
});

test('改行・箇条書きでまとめて入れる', () => {
  const list = L.parseInput('- 牛乳を買う\n・歯医者\n\n1. 返信する\n1.5倍にする\n2026.10.30 の資料');
  assert.deepEqual(list.map(t => t.title), ['牛乳を買う', '歯医者', '返信する', '1.5倍にする', '2026.10.30 の資料']);
  assert.deepEqual(L.parseInput('  \n\n'), []);
});

const ev = (t, x, at = 1000) => ({ id: `e${Math.random().toString(36).slice(2)}`, t, at, ...x });

test('入れる・直す・取り出す・戻す・消す', () => {
  const st = L.emptyState();
  assert.ok(L.applyEvent(st, ev('task.add', { task: { id: 'a1', title: ' 歯医者に電話 ', from: { via: 'claude', where: 'donichi', device: 'Mac' } } })));
  const t = st.tasks.a1;
  assert.equal(t.title, '歯医者に電話');
  assert.equal(t.status, 'open');
  assert.equal(L.sourceLabel(t.from), 'Claude · donichi');

  L.applyEvent(st, ev('task.edit', { taskId: 'a1', edits: { note: 'メモ', title: '   ', url: 'https://example.com' } }, 2000));
  assert.equal(t.note, 'メモ');
  assert.equal(t.url, 'https://example.com/');
  assert.equal(t.title, '歯医者に電話', '空の題名には変えない');

  L.applyEvent(st, ev('task.done', { taskId: 'a1' }, 3000));
  assert.equal(t.status, 'done'); assert.equal(t.doneAt, 3000);
  assert.deepEqual(L.inBox(st), [], '取り出したものは箱に出ない');
  L.applyEvent(st, ev('task.reopen', { taskId: 'a1' }, 4000));
  assert.equal(t.status, 'open'); assert.equal(t.doneAt, 0);
  L.applyEvent(st, ev('task.delete', { taskId: 'a1' }));
  assert.equal(st.tasks.a1, undefined);
});

test('箱の中は新しく入れたものが上', () => {
  const st = L.emptyState();
  L.applyEvent(st, ev('task.add', { task: { id: 'old', title: '古い' } }, 1000));
  L.applyEvent(st, ev('task.add', { task: { id: 'new', title: '新しい' } }, 2000));
  assert.deepEqual(L.inBox(st).map(t => t.id), ['new', 'old']);
});

test('同じイベントは二度反映しない・おかしな値ははじく', () => {
  const st = L.emptyState();
  const e = ev('task.add', { task: { id: 'b1', title: 'x' } });
  assert.ok(L.applyEvent(st, e));
  assert.equal(L.applyEvent(st, e), false);
  L.applyEvent(st, ev('task.add', { task: { id: '__proto__', title: 'x' } }));
  L.applyEvent(st, ev('task.add', { task: { id: 'b2', title: '' } }));
  L.applyEvent(st, ev('task.add', { task: { id: 'b3', title: 'y', url: 'javascript:alert(1)', from: { via: 'evil' } } }));
  assert.deepEqual(Object.keys(st.tasks).sort(), ['b1', 'b3']);
  assert.equal(st.tasks.b3.url, '');
  assert.equal(st.tasks.b3.from.via, 'app');
  assert.equal(Object.getPrototypeOf(st.tasks), Object.prototype);
  L.applyEvent(st, ev('task.edit', { taskId: 'constructor', edits: { title: 'z' } }));
  assert.equal(L.applyEvent(st, null), false);
});

test('項目より先に届いた変更は預かって、項目が届いたら当てる', () => {
  const st = L.emptyState();
  L.applyEvent(st, { id: 'd1', t: 'task.done', taskId: 'x1', at: 2000 });
  L.applyEvent(st, { id: 'e1', t: 'task.edit', taskId: 'x1', at: 1500, edits: { note: '預かったメモ', __proto__: { evil: 1 } } });
  assert.equal(st.log.pending.length, 2);
  assert.equal(st.log.applied.includes('d1'), false, '預かった変更は済みにしない');
  L.applyEvent(st, { id: 'd1', t: 'task.done', taskId: 'x1', at: 2000 });
  assert.equal(st.log.pending.length, 2, '同じ変更は二重に預からない');
  L.applyEvent(st, { id: 'a1', t: 'task.add', at: 1000, task: { id: 'x1', title: '送り直された追加' } });
  const t = st.tasks.x1;
  assert.equal(t.status, 'done');
  assert.equal(t.note, '預かったメモ');
  assert.equal(st.log.pending.length, 0);
  assert.ok(['a1', 'd1', 'e1'].every(id => st.log.applied.includes(id)));
});

test('消したものは、追加が送り直されても戻らない', () => {
  const st = L.emptyState();
  L.applyEvent(st, { id: 'a1', t: 'task.add', at: 1000, task: { id: 'y1', title: '消すもの' } });
  L.applyEvent(st, { id: 'x1', t: 'task.delete', taskId: 'y1', at: 2000 });
  L.applyEvent(st, { id: 'a1-resend', t: 'task.add', at: 1000, task: { id: 'y1', title: '消すもの' } });
  assert.equal(st.tasks.y1, undefined);
  const st2 = L.emptyState();
  L.applyEvent(st2, { id: 'x2', t: 'task.delete', taskId: 'y2', at: 2000 });
  L.applyEvent(st2, { id: 'a2', t: 'task.add', at: 1000, task: { id: 'y2', title: '消すもの' } });
  assert.equal(st2.tasks.y2, undefined);
});

test('項目ごとに新しい変更が勝つ（遅れて届いた古い変更で上書きしない）', () => {
  const st = L.emptyState();
  L.applyEvent(st, { id: 'a', t: 'task.add', at: 1000, task: { id: 'z', title: 'もと' } });
  L.applyEvent(st, { id: 'e2', t: 'task.edit', taskId: 'z', at: 3000, edits: { title: '新しい題名' } });
  L.applyEvent(st, { id: 'e1', t: 'task.edit', taskId: 'z', at: 2000, edits: { title: '古い題名', note: 'メモは新しい' } });
  assert.equal(st.tasks.z.title, '新しい題名');
  assert.equal(st.tasks.z.note, 'メモは新しい', '別の項目は当たる');
  L.applyEvent(st, { id: 'r', t: 'task.reopen', taskId: 'z', at: 5000 });
  L.applyEvent(st, { id: 'd', t: 'task.done', taskId: 'z', at: 4000 });
  assert.equal(st.tasks.z.status, 'open', '後から届いた古い「取り出す」で戻らない');
});

test('取り出して半年たったもの・届かない変更を片づける', () => {
  const now = Date.parse('2026-10-27T12:00:00+09:00');
  const st = L.emptyState();
  st.tasks.old = { id: 'old', status: 'done', doneAt: now - 200 * 86400000 };
  st.tasks.new = { id: 'new', status: 'done', doneAt: now - 10 * 86400000 };
  st.tasks.open = { id: 'open', status: 'open', doneAt: 0 };
  L.applyEvent(st, { id: 'p', t: 'task.done', taskId: 'nobody', at: now - 8 * 86400000 });
  assert.ok(L.maintain(st, now));
  assert.deepEqual(Object.keys(st.tasks).sort(), ['new', 'open']);
  assert.equal(st.log.pending.length, 0);
  assert.equal(L.maintain(st, now), false);
});

test('入れるだけのリンクから届いたものは、追加だけ・二重にならない', () => {
  const st = L.emptyState();
  const d = { v: 1, id: 'Zx9_drop-1', items: [{ title: ' 歯医者に電話 ' }, 'この記事を読む https://example.com/a', { title: '' }], note: 'メモ', by: 'ChatGPT' };
  const evs = L.fromDrop(d, 1761600000);
  assert.equal(evs.length, 3);
  assert.ok(evs.every(e => e.t === 'task.add' && e.at === 1761600000000));
  for (const e of evs) L.applyEvent(st, e);
  const list = L.inBox(st);
  assert.deepEqual(list.map(t => t.title), ['歯医者に電話', 'この記事を読む']);
  assert.equal(list[1].url, 'https://example.com/a');
  assert.equal(list[0].note, 'メモ');
  assert.equal(L.sourceLabel(list[0].from), 'ChatGPT');
  assert.equal(L.sourceLabel({ via: 'drop', where: '' }), 'リンクから');
  // 同じものが二度届いても（送り直し・押し直し）1つのまま
  for (const e of L.fromDrop(d, 1761600100)) L.applyEvent(st, { ...e, id: `${e.id}` });
  assert.equal(Object.keys(st.tasks).length, 2);
  // 消したあとに同じものが届いても戻らない
  L.applyEvent(st, { id: 'x', t: 'task.delete', taskId: list[0].id, at: 1761600200000 });
  st.log.applied = st.log.applied.filter(id => !id.startsWith('drop-'));
  for (const e of L.fromDrop(d, 1761600000)) L.applyEvent(st, e);
  assert.equal(st.tasks[list[0].id], undefined);
  // おかしなものは入れない
  assert.deepEqual(L.fromDrop({ id: '__proto__', items: ['x'] }, 1), []);
  assert.deepEqual(L.fromDrop({ id: 'a'.repeat(41), items: ['x'] }, 1), []);
  assert.deepEqual(L.fromDrop({ id: 'ok', items: 'x' }, 1), []);
  assert.deepEqual(L.fromDrop(null, 1), []);
  assert.equal(L.fromDrop({ id: 'many', items: Array(50).fill('x') }, 1).length, L.DROP_MAX_ITEMS);
  const evil = L.fromDrop({ id: 'ev', items: [{ title: 'y', url: 'javascript:alert(1)' }], by: 'x'.repeat(500) }, 1);
  L.applyEvent(st, evil[0]);
  const e0 = st.tasks[evil[0].task.id];
  assert.equal(e0.url, '');
  assert.ok(e0.from.where.length <= 60);
  assert.equal(e0.from.via, 'drop');
  // 同じ便で届いたものは、番号の頭5文字で見分けがつく
  const ids = L.fromDrop({ id: 'CTOFZC3YYNkkS1-yYiloy', items: ['a', 'b', 'c'] }, 1).map(e => e.task.id.slice(0, 5));
  assert.equal(new Set(ids).size, 3);
});
