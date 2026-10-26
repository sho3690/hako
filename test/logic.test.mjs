import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as L from '../logic.js';

// 2026-10-27 は火曜
const T = '2026-10-27';

test('今日は朝7時区切り（日本時間）', () => {
  assert.equal(L.jstToday(Date.parse('2026-10-27T06:59:00+09:00')), '2026-10-26');
  assert.equal(L.jstToday(Date.parse('2026-10-27T07:00:00+09:00')), '2026-10-27');
  assert.equal(L.jstToday(Date.parse('2026-10-27T23:30:00+09:00')), '2026-10-27');
});

test('日付の言葉を読む', () => {
  const w = s => L.resolveWhen(s, T);
  assert.equal(w('今日'), T);
  assert.equal(w('明日'), '2026-10-28');
  assert.equal(w('あさって'), '2026-10-29');
  assert.equal(w('金曜'), '2026-10-30');
  assert.equal(w('火曜'), T, '今日と同じ曜日は今日');
  assert.equal(w('月曜'), '2026-11-02');
  assert.equal(w('来週の水曜'), '2026-11-04');
  assert.equal(w('今週末'), '2026-10-31');
  assert.equal(w('来週'), '2026-11-02');
  assert.equal(w('今週中'), '2026-10-30');
  assert.equal(w('月末'), '2026-10-31');
  assert.equal(w('来月末'), '2026-11-30');
  assert.equal(w('来月'), '2026-11-01');
  assert.equal(w('3日後'), '2026-10-30');
  assert.equal(w('2週間後'), '2026-11-10');
  assert.equal(w('10/30'), '2026-10-30');
  assert.equal(w('11月3日'), '2026-11-03');
  assert.equal(w('1/5'), '2027-01-05', '2か月以上前の日付は来年');
  assert.equal(w('2027-02-01'), '2027-02-01');
  assert.equal(w('なし'), '');
  assert.equal(w('そのうち'), null);
  assert.equal(w('2/30'), null, 'ありえない日付は読まない');
});

test('週末に「週末」は今日', () => {
  assert.equal(L.resolveWhen('週末', '2026-10-31'), '2026-10-31');
  assert.equal(L.resolveWhen('週末', '2026-11-01'), '2026-11-01');
});

test('1行を読む: 日付・タグ・リンク', () => {
  assert.deepEqual(L.parseLine('明日 歯医者に電話', T), { title: '歯医者に電話', due: '2026-10-28', tags: [], url: '' });
  assert.deepEqual(L.parseLine('歯医者に電話 明日', T), { title: '歯医者に電話', due: '2026-10-28', tags: [], url: '' });
  assert.equal(L.parseLine('明日までに資料を送る', T).title, '資料を送る');
  assert.equal(L.parseLine('月末までに、請求書 #仕事', T).title, '請求書');
  // 文の途中の日付は題名に残す
  const mid = L.parseLine('企画書を金曜までに出す', T);
  assert.equal(mid.title, '企画書を金曜までに出す');
  assert.equal(mid.due, '2026-10-30');
  assert.equal(L.parseLine('明日の会議の資料', T).title, '明日の会議の資料');
  assert.equal(L.parseLine('明日の会議の資料', T).due, '2026-10-28');
  // 全角の数字・記号
  const z = L.parseLine('１０／３０（金） 経費精算 ＃仕事', T);
  assert.deepEqual([z.title, z.due, z.tags], ['経費精算', '2026-10-30', ['仕事']]);
  // リンク
  const u = L.parseLine('この記事を読む https://example.com/a/b?x=1', T);
  assert.equal(u.title, 'この記事を読む');
  assert.equal(u.url, 'https://example.com/a/b?x=1');
  assert.equal(L.parseLine('https://example.com/post', T).title, 'example.com/post');
  // C# のような語中の # はタグにしない
  assert.deepEqual(L.parseLine('C# の本を返す', T).tags, []);
  // 日付の言葉だけの行
  assert.equal(L.parseLine('明日', T).title, '明日');
});

test('複数行・箇条書きをまとめて読む', () => {
  const list = L.parseInput('- 牛乳を買う\n・明日 歯医者\n\n1. 返信する #仕事\n', T);
  assert.deepEqual(list.map(t => t.title), ['牛乳を買う', '歯医者', '返信する']);
  assert.equal(list[1].due, '2026-10-28');
  assert.deepEqual(list[2].tags, ['仕事']);
});

const ev = (t, x, at = 1000) => ({ id: `e${Math.random().toString(36).slice(2)}`, t, at, ...x });

test('イベントで箱を更新する', () => {
  const st = L.emptyState();
  assert.ok(L.applyEvent(st, ev('task.add', { task: { id: 'a1', title: ' 歯医者に電話 ', due: '2026-10-28', tags: '仕事 #家', from: { via: 'claude', where: 'donichi', device: 'Mac' } } })));
  const t = st.tasks.a1;
  assert.equal(t.title, '歯医者に電話');
  assert.deepEqual(t.tags, ['仕事', '家']);
  assert.equal(t.status, 'open');
  assert.equal(L.sourceLabel(t.from), 'Claude · donichi');

  L.applyEvent(st, ev('task.edit', { taskId: 'a1', edits: { due: '', note: 'メモ', title: '   ' } }, 2000));
  assert.equal(t.due, '');
  assert.equal(t.note, 'メモ');
  assert.equal(t.title, '歯医者に電話', '空の題名には変えない');

  L.applyEvent(st, ev('task.done', { taskId: 'a1' }, 3000));
  assert.equal(t.status, 'done'); assert.equal(t.doneAt, 3000);
  L.applyEvent(st, ev('task.reopen', { taskId: 'a1' }, 4000));
  assert.equal(t.status, 'open'); assert.equal(t.doneAt, 0);
  L.applyEvent(st, ev('task.delete', { taskId: 'a1' }));
  assert.equal(st.tasks.a1, undefined);
});

test('同じイベントは二度反映しない・おかしな値ははじく', () => {
  const st = L.emptyState();
  const e = ev('task.add', { task: { id: 'b1', title: 'x' } });
  assert.ok(L.applyEvent(st, e));
  assert.equal(L.applyEvent(st, e), false);
  L.applyEvent(st, ev('task.add', { task: { id: '__proto__', title: 'x' } }));
  L.applyEvent(st, ev('task.add', { task: { id: 'b2', title: '' } }));
  L.applyEvent(st, ev('task.add', { task: { id: 'b3', title: 'y', due: '2026-02-30', url: 'javascript:alert(1)', from: { via: 'evil' } } }));
  assert.deepEqual(Object.keys(st.tasks).sort(), ['b1', 'b3']);
  assert.equal(st.tasks.b3.due, '');
  assert.equal(st.tasks.b3.url, '');
  assert.equal(st.tasks.b3.from.via, 'app');
  assert.equal(Object.getPrototypeOf(st.tasks), Object.prototype);
  L.applyEvent(st, ev('task.edit', { taskId: 'constructor', edits: { title: 'z' } }));
  assert.equal(L.applyEvent(st, null), false);
});

test('日付で分ける・並べる', () => {
  const mk = (id, due, addedAt) => ({ id, title: id, due, tags: [], addedAt, status: 'open' });
  const list = [mk('none1', '', 1), mk('later', '2026-11-20', 2), mk('over', '2026-10-20', 3), mk('today', T, 4), mk('none2', '', 5), mk('tmr', '2026-10-28', 6), mk('wk', '2026-11-02', 7)];
  const g = L.groupTasks(list, T);
  assert.deepEqual(g.map(x => x.key), ['overdue', 'today', 'tomorrow', 'week', 'later', 'none']);
  assert.deepEqual(g.at(-1).tasks.map(t => t.id), ['none2', 'none1'], '日付なしは新しい順');
  assert.equal(L.dueLabel('2026-10-26', T), '昨日');
  assert.equal(L.dueLabel('2026-10-30', T), '10/30(金)');
  assert.equal(L.dueLabel('2027-01-05', T), '2027/1/5(火)');
  assert.equal(L.overdueDays('2026-10-20', T), 7);
});

test('済んでから半年たったものを片づける', () => {
  const now = Date.parse('2026-10-27T12:00:00+09:00');
  const st = L.emptyState();
  st.tasks.old = { id: 'old', status: 'done', doneAt: now - 200 * 86400000 };
  st.tasks.new = { id: 'new', status: 'done', doneAt: now - 10 * 86400000 };
  st.tasks.open = { id: 'open', status: 'open', doneAt: 0 };
  assert.ok(L.maintain(st, now));
  assert.deepEqual(Object.keys(st.tasks).sort(), ['new', 'open']);
  assert.equal(L.maintain(st, now), false);
});

test('入れるときの日付の選択肢', () => {
  assert.deepEqual(L.quickDates(T).map(x => x[0]), ['', T, '2026-10-28', '2026-10-31', '2026-11-02']);
});

test('ふだんの言い方の読み違いを防ぐ（レビューで見つかったもの）', () => {
  const w = s => L.findWhen(s, T)?.due || '';
  assert.equal(w('来週末に引っ越し'), '2026-11-07');
  assert.equal(w('来月10日に支払い'), '2026-11-10');
  assert.equal(w('今月30日まで'), '2026-10-30');
  assert.equal(w('明日香さんに連絡'), '', '人の名前は日付にしない');
  assert.equal(w('今日子さんに電話'), '');
  assert.equal(w('先週の金曜の会議メモをまとめる'), '');
  assert.equal(w('先週末の写真を送る'), '');
  const d = L.parseLine('2026.10.30 歯医者', T);
  assert.deepEqual([d.title, d.due], ['歯医者', '2026-10-30']);
  assert.deepEqual(L.parseInput('1.5倍にする\n2) 返信する', T).map(t => t.title), ['1.5倍にする', '返信する']);
  // CLI の --due は言葉の全体が日付のときだけ
  assert.equal(L.resolveWhen('来週末', T), '2026-11-07');
  assert.equal(L.resolveWhen('金曜まで', T), '2026-10-30');
  assert.equal(L.resolveWhen('来週の打ち合わせ前', T), null);
  assert.equal(L.resolveWhen('１０／３０', T), '2026-10-30');
});

test('項目より先に届いた変更は預かって、項目が届いたら当てる', () => {
  const st = L.emptyState();
  L.applyEvent(st, { id: 'd1', t: 'task.done', taskId: 'x1', at: 2000 });
  L.applyEvent(st, { id: 'e1', t: 'task.edit', taskId: 'x1', at: 1500, edits: { due: '2026-11-01', __proto__: { evil: 1 } } });
  assert.equal(st.log.pending.length, 2);
  assert.equal(st.log.applied.includes('d1'), false, '預かった変更は済みにしない');
  L.applyEvent(st, { id: 'd1', t: 'task.done', taskId: 'x1', at: 2000 });
  assert.equal(st.log.pending.length, 2, '同じ変更は二重に預からない');
  L.applyEvent(st, { id: 'a1', t: 'task.add', at: 1000, task: { id: 'x1', title: '送り直された追加' } });
  const t = st.tasks.x1;
  assert.equal(t.status, 'done');
  assert.equal(t.due, '2026-11-01');
  assert.equal(st.log.pending.length, 0);
  assert.ok(['a1', 'd1', 'e1'].every(id => st.log.applied.includes(id)));
});

test('消したものは、追加が送り直されても戻らない', () => {
  const st = L.emptyState();
  L.applyEvent(st, { id: 'a1', t: 'task.add', at: 1000, task: { id: 'y1', title: '消すもの' } });
  L.applyEvent(st, { id: 'x1', t: 'task.delete', taskId: 'y1', at: 2000 });
  L.applyEvent(st, { id: 'a1-resend', t: 'task.add', at: 1000, task: { id: 'y1', title: '消すもの' } });
  assert.equal(st.tasks.y1, undefined);
  // 追加より先に届いた削除も同じ
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
  assert.equal(st.tasks.z.status, 'open', '後から届いた古い「済み」で戻らない');
});

test('1週間たっても項目が届かない変更は片づける', () => {
  const now = Date.parse('2026-10-27T12:00:00+09:00');
  const st = L.emptyState();
  L.applyEvent(st, { id: 'p', t: 'task.done', taskId: 'nobody', at: now - 8 * 86400000 });
  assert.ok(L.maintain(st, now));
  assert.equal(st.log.pending.length, 0);
});
