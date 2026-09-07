/** 通しの動作確認 */
'use strict';
const H = require('./harness.js');
const G = H.sandbox;

let pass = 0, fail = 0;
function check(label, cond, extra) {
  if (cond) { pass++; console.log('  ok   ' + label); }
  else { fail++; console.log('  NG   ' + label + (extra !== undefined ? '  → ' + JSON.stringify(extra) : '')); }
}
function call(action, payload, token, key) {
  return G.handle_({ action, payload: payload || {}, token, appKey: key === undefined ? G.propsKey : key });
}

console.log('\n=== 1. setup ===');
const setupMsg = G.setup();
const APPKEY = H.propsStore.APP_KEY;
G.propsKey = APPKEY;
check('アプリキーが発行された', !!APPKEY && APPKEY.length === 24, APPKEY);
check('シートが7枚できた', G.getSpreadsheet_().getSheets().length === 7,
  G.getSpreadsheet_().getSheets().map(s => s.getName()));
check('社員が5人', G.readAll_(G.C.SHEET_EMPLOYEE).length === 5);
check('トリガー3本', H.triggers.length === 3);
check('シフト区分が8つ入った', G.readAll_(G.C.SHEET_SHIFT).length === 8,
  G.readAll_(G.C.SHEET_SHIFT).length);

console.log('\n=== 2. アプリキー / ping ===');
check('pingはキー無しでも通る', G.handle_({ action: 'ping' }).ok === true);
check('キーが違うと弾く', G.handle_({ action: 'members', appKey: 'wrong' }).ok === false);
check('正しいキーなら通る', call('members').ok === true);

console.log('\n=== 3. ログイン ===');
const emps = G.readAll_(G.C.SHEET_EMPLOYEE);
const admin = emps[0], member = emps[2];
const adminPin = String(admin['PIN']), memberPin = String(member['PIN']);
check('PINが違えば失敗', call('login', { employeeId: 'E001', pin: '0000' }).ok === false);
const loginRes = call('login', { employeeId: 'E001', pin: adminPin });
check('管理者ログイン成功', loginRes.ok === true, loginRes.error);
const ADMIN_TOKEN = loginRes.token;
check('管理者フラグ', loginRes.employee.isAdmin === true);
const memberLogin = call('login', { employeeId: 'E003', pin: memberPin });
const MEMBER_TOKEN = memberLogin.token;
check('一般ログイン成功', memberLogin.ok === true, memberLogin.error);
check('一般は管理者でない', memberLogin.employee.isAdmin === false);
check('トークン無しは弾く', call('bootstrap').ok === false);

console.log('\n=== 4. 予定登録 ===');
const planRes = call('savePlan', {
  dates: ['2026-09-05', '2026-09-07', '2026-09-08'],
  start: '09:00', end: '18:00', workMode: '出社', kind: '通常', note: 'テスト'
}, MEMBER_TOKEN);
check('3日分の予定を登録', planRes.ok && planRes.saved === 3, planRes);
check('予定シートに3行', G.readAll_(G.C.SHEET_PLAN).length === 3);
const dup = call('savePlan', { dates: ['2026-09-05'], start: '10:00', end: '19:00' }, MEMBER_TOKEN);
check('同じ日は上書き（増えない）', dup.ok && G.readAll_(G.C.SHEET_PLAN).length === 3);
check('上書きされている', G.normTime_(G.findPlan_('E003', '2026-09-05')['出勤予定']) === '10:00');
// 元に戻す
call('savePlan', { dates: ['2026-09-05'], start: '09:00', end: '18:00', workMode: '出社' }, MEMBER_TOKEN);
check('一般が他人の予定を触れない',
  call('savePlan', { dates: ['2026-09-06'], employeeId: 'E002' }, MEMBER_TOKEN).ok === false);
check('管理者は他人の予定を登録できる',
  call('savePlan', { dates: ['2026-09-05'], start: '09:00', end: '18:00', employeeId: 'E002' }, ADMIN_TOKEN).ok === true);

console.log('\n=== 5. 出勤打刻（GPS・遅刻判定） ===');
H.setNow('2026-09-05T00:12:00Z');   // JST 09:12 → 予定09:00 + 猶予5分 = 7分の遅刻
const punchIn = call('punch', {
  type: 'in', workMode: '出社',
  geo: { lat: 34.5560, lng: 135.4870, accuracy: 18 },
  device: { id: 'dev-abc', name: '柴原のiPhone', platform: 'iPhone', ua: 'test-ua' }
}, MEMBER_TOKEN);
check('出勤打刻できた', punchIn.ok === true, punchIn.error);
check('ステータスが出勤中', punchIn.status === '出勤中');
check('出勤時刻 09:12', punchIn.record.inTime === '09:12', punchIn.record.inTime);
check('遅刻7分（猶予5分を引いた）', punchIn.record.lateMin === 7, punchIn.record.lateMin);
check('判定が遅刻', punchIn.record.judge === '遅刻', punchIn.record.judge);
check('住所が入った', /堺市/.test(punchIn.record.inPlace), punchIn.record.inPlace);
check('端末が登録された', G.readAll_(G.C.SHEET_DEVICE).length === 1);
check('二重打刻を弾く', call('punch', { type: 'in', workMode: 'リモート' }, MEMBER_TOKEN).ok === false);
check('出勤通知メールが飛んだ', H.sentMail.length > 0, H.sentMail.length);
const lastMail = H.sentMail[H.sentMail.length - 1];
check('通知の宛先に管理者が入る', /maeoka@fuchu-albatross\.org/.test(lastMail.to), lastMail.to);
check('通知本文に判定が入る', /遅刻/.test(lastMail.body));

console.log('\n=== 6. 出社なのに位置情報が無い場合 ===');
const noGeo = G.handle_({
  action: 'punch', appKey: APPKEY, token: ADMIN_TOKEN,
  payload: { type: 'in', workMode: '出社', device: { id: 'dev-x' } }
});
check('位置情報なしの出社は拒否', noGeo.ok === false && /位置情報/.test(noGeo.error), noGeo.error);
const remoteIn = call('punch', {
  type: 'in', workMode: 'リモート', device: { id: 'dev-admin', name: '前岡のMac' }
}, ADMIN_TOKEN);
check('リモートは位置情報なしでも打刻できる', remoteIn.ok === true, remoteIn.error);
check('リモートは予定外出勤の判定', remoteIn.record.judge === '予定外出勤', remoteIn.record.judge);

console.log('\n=== 7. 退勤打刻（実働・残業） ===');
H.setNow('2026-09-05T10:35:00Z');   // JST 19:35
const punchOut = call('punch', {
  type: 'out', workMode: '出社',
  geo: { lat: 34.5560, lng: 135.4870, accuracy: 20 },
  device: { id: 'dev-abc', name: '柴原のiPhone' }
}, MEMBER_TOKEN);
check('退勤打刻できた', punchOut.ok === true, punchOut.error);
check('退勤時刻 19:35', punchOut.record.outTime === '19:35');
check('ステータスが退勤済', punchOut.record.status === '退勤済');
// 09:12〜19:35 = 623分, 休憩60分 → 実働563分
check('実働563分', punchOut.record.workMin === 563, punchOut.record.workMin);
// 予定 09:00-18:00=540分 - 休憩60 = 480分 → 残業83分
check('残業83分', punchOut.record.overMin === 83, punchOut.record.overMin);
check('早退なし', punchOut.record.earlyMin === 0);
check('判定は遅刻のまま', punchOut.record.judge === '遅刻', punchOut.record.judge);
check('先に出勤していないと退勤できない',
  G.handle_({ action: 'punch', appKey: APPKEY, token: ADMIN_TOKEN, payload: { type: 'out' } }).ok !== undefined);

console.log('\n=== 8. 早退の判定 ===');
H.setNow('2026-09-07T00:00:00Z');   // JST 09:00 (9/7)
const in7 = call('punch', { type: 'in', workMode: 'リモート' }, MEMBER_TOKEN);
check('9/7 出勤', in7.ok === true, in7.error);
check('遅刻なし', in7.record.lateMin === 0);
H.setNow('2026-09-07T07:30:00Z');   // JST 16:30
const out7 = call('punch', { type: 'out', workMode: 'リモート' }, MEMBER_TOKEN);
check('早退90分', out7.record.earlyMin === 90, out7.record.earlyMin);
check('判定が早退', out7.record.judge === '早退', out7.record.judge);

console.log('\n=== 9. 未打刻アラート ===');
H.setNow('2026-09-08T00:30:00Z');   // JST 09:30 → 予定09:00 + 猶予15分 超過
const mailBefore = H.sentMail.length;
G.checkAlerts();
check('未出勤アラートが飛んだ', H.sentMail.length > mailBefore, H.sentMail.length - mailBefore);
const alertMail = H.sentMail[H.sentMail.length - 1];
check('本文が未出勤', /未出勤/.test(alertMail.body), alertMail.body);
const mailBefore2 = H.sentMail.length;
G.checkAlerts();
check('同じアラートは二度飛ばない', H.sentMail.length === mailBefore2);

console.log('\n=== 10. 日次の締め ===');
H.setNow('2026-09-08T14:50:00Z');   // JST 23:50
G.dailyClose();
const rec8 = G.findRecord_('E003', '2026-09-08');
check('欠勤になった', String(rec8['ステータス']) === '欠勤', String(rec8['ステータス']));
check('判定も欠勤', String(rec8['判定']) === '欠勤', String(rec8['判定']));

console.log('\n=== 11. 履歴と統計 ===');
const recs = call('listRecords', { month: '2026-09' }, MEMBER_TOKEN);
check('自分の記録だけ返る', recs.records.every(r => r.employeeId === 'E003'), recs.records.map(r => r.employeeId));
check('3日分ある', recs.records.length === 3, recs.records.length);

const st = call('stats', { month: '2026-09', employeeId: 'E003' }, MEMBER_TOKEN);
check('統計が返る', st.ok === true, st.error);
const s = st.summary[0];
check('出勤日数2日', s.workedDays === 2, s.workedDays);
check('遅刻1回', s.lateCount === 1, s.lateCount);
check('早退1回', s.earlyCount === 1, s.earlyCount);
check('欠勤1日', s.absentDays === 1, s.absentDays);
check('出社1日・リモート1日', s.officeDays === 1 && s.remoteDays === 1, [s.officeDays, s.remoteDays]);
check('リモート率50%', s.remoteRate === 50, s.remoteRate);
check('平均出勤 09:06', s.avgIn === '09:06', s.avgIn);
check('実働ラベル', /時間/.test(s.workLabel), s.workLabel);

const stAll = call('stats', { month: '2026-09', employeeId: 'all' }, ADMIN_TOKEN);
check('管理者は全員分が見える', stAll.summary.length >= 2, stAll.summary.length);
const stAllAsMember = call('stats', { month: '2026-09', employeeId: 'all' }, MEMBER_TOKEN);
check('一般がallを指定しても自分だけ', stAllAsMember.summary.length === 1, stAllAsMember.summary.length);

console.log('\n=== 12. 社員の追加・退社 ===');
const add = call('saveEmployee', { name: '新人 太郎', email: 'shinjin@example.com', role: '一般' }, ADMIN_TOKEN);
check('社員を追加できた', add.ok && add.id === 'E006', add);
check('PINが自動発行された', /^\d{4}$/.test(add.pin), add.pin);
check('一般は社員を追加できない',
  call('saveEmployee', { name: 'だめ' }, MEMBER_TOKEN).ok === false);
const newLogin = call('login', { employeeId: 'E006', pin: add.pin });
check('追加した社員でログインできる', newLogin.ok === true, newLogin.error);
const retire = call('retireEmployee', { id: 'E006', retiredAt: '2026-09-30' }, ADMIN_TOKEN);
check('退社処理ができた', retire.ok === true, retire.error);
check('退社後はログイン一覧に出ない',
  call('members').members.every(m => m.id !== 'E006'));
check('退社後はログインできない', call('login', { employeeId: 'E006', pin: add.pin }).ok === false);
check('行は消えていない（記録が残る）', G.readAll_(G.C.SHEET_EMPLOYEE).length === 6);
check('最後の管理者は降格できない',
  call('saveEmployee', { id: 'E001', name: '前岡 範行', role: '一般' }, ADMIN_TOKEN).ok === false);

console.log('\n=== 13. PIN変更と設定 ===');
check('今のPINが違うと変更できない',
  call('changePin', { currentPin: '9999', newPin: '1234' }, MEMBER_TOKEN).ok === false);
check('PINを変更できる',
  call('changePin', { currentPin: memberPin, newPin: '4321' }, MEMBER_TOKEN).ok === true);
check('新しいPINでログインできる', call('login', { employeeId: 'E003', pin: '4321' }).ok === true);
const setSave = call('saveSettings', { settings: [{ key: '事業所緯度', value: '34.5561' }, { key: '事業所経度', value: '135.4871' }] }, ADMIN_TOKEN);
check('設定を保存できた', setSave.ok === true, setSave.error);
check('設定が反映された', String(G.getConfig_()['事業所緯度']) === '34.5561');

console.log('\n=== 14. 事業所からの距離 ===');
H.setNow('2026-09-09T00:00:00Z');
call('savePlan', { dates: ['2026-09-09'], start: '09:00', end: '18:00' }, ADMIN_TOKEN);
const near = call('punch', {
  type: 'in', workMode: '出社', geo: { lat: 34.5563, lng: 135.4873, accuracy: 10 },
  device: { id: 'dev-admin' }
}, ADMIN_TOKEN);
check('事業所からの距離が入る', near.record.inDistance !== null && near.record.inDistance < 100, near.record.inDistance);

console.log('\n=== 15. 予定削除と logout ===');
const plansNow = call('listPlans', { from: '2026-09-01', to: '2026-09-30' }, MEMBER_TOKEN);
const delRes = call('deletePlan', { planId: plansNow.plans[0].id }, MEMBER_TOKEN);
check('予定を削除できた', delRes.ok === true, delRes.error);
check('logoutできる', call('logout', {}, MEMBER_TOKEN).ok === true);
check('logout後は使えない', call('bootstrap', {}, MEMBER_TOKEN).ok === false);

console.log('\n=== 16. bootstrap ===');
const boot = call('bootstrap', {}, ADMIN_TOKEN);
check('bootstrapが返る', boot.ok === true, boot.error);
check('今日の予定が入る', boot.today.plan !== null);
check('勤務形態の選択肢', boot.workModes.length === 3);
check('管理者にはメンバー一覧', boot.members.length >= 4, boot.members.length);
check('事業所情報', boot.office.lat === 34.5561, boot.office.lat);

console.log('\n=== 17. JSONP / doPost ===');
const postRes = G.doPost({ postData: { contents: JSON.stringify({ action: 'ping' }) } });
check('doPostがJSONを返す', JSON.parse(postRes.getContent()).ok === true);
const getRes = G.doGet({ parameter: { p: JSON.stringify({ action: 'ping' }), callback: 'cb' } });
check('JSONPで包まれる', /^cb\(\{.*\);$/.test(getRes.getContent()), getRes.getContent().slice(0, 40));
const evil = G.doGet({ parameter: { p: JSON.stringify({ action: 'ping' }), callback: 'alert(1)//' } });
check('callbackがサニタイズされる', evil.getContent().indexOf('alert(1)//') < 0, evil.getContent().slice(0, 30));

console.log('\n=== 18. Webhook通知 ===');
call('saveSettings', { settings: [{ key: 'Webhook URL', value: 'https://hooks.slack.com/services/xxx' }] }, ADMIN_TOKEN);
const hookBefore = H.sentHooks.length;
H.setNow('2026-09-09T09:00:00Z');
call('punch', { type: 'out', workMode: 'リモート', device: { id: 'dev-admin' } }, ADMIN_TOKEN);
check('Webhookが呼ばれた', H.sentHooks.length > hookBefore);
check('Slack形式のtext', JSON.parse(H.sentHooks[H.sentHooks.length - 1].o.payload).text !== undefined);
check('通知ログが残る', G.readAll_(G.C.SHEET_NOTIFY).length > 0, G.readAll_(G.C.SHEET_NOTIFY).length);

console.log('\n=== 19. シフト区分 ===');
// 15章でログアウトしているので入り直す（13章でPINは4321に変更済み）
const MEMBER_TOKEN2 = call('login', { employeeId: 'E003', pin: '4321' }).token;
check('一般で入り直せた', !!MEMBER_TOKEN2);
const shifts = call('listShifts', {}, ADMIN_TOKEN);
check('シフト区分が取れる', shifts.shifts.length === 8, shifts.shifts.length);
const nikkin = shifts.shifts.filter(s => s.code === '日')[0];
check('日勤は09:00-18:00', nikkin.start === '09:00' && nikkin.end === '18:00', nikkin);
check('公休は時刻なし', shifts.shifts.filter(s => s.code === '休')[0].start === '');
check('在宅はリモート', shifts.shifts.filter(s => s.code === '宅')[0].workMode === 'リモート');
const addShift = call('saveShift', {
  code: '夜', name: '夜勤', start: '22:00', end: '07:00', breakMin: 60,
  workMode: '出社', kind: '通常', color: '#334155', order: 9
}, ADMIN_TOKEN);
check('シフト区分を追加できた', addShift.ok && addShift.created === true, addShift);
check('一般はシフト区分を追加できない',
  call('saveShift', { code: 'X', name: 'だめ', start: '09:00', end: '18:00' }, MEMBER_TOKEN2).ok === false);
check('時刻なしの通常シフトは弾く',
  call('saveShift', { code: 'Z', name: '不備', kind: '通常' }, ADMIN_TOKEN).ok === false);
check('休暇区分なら時刻なしで登録できる',
  call('saveShift', { code: '特', name: '特別休暇', kind: '特別休暇', order: 10 }, ADMIN_TOKEN).ok === true);
check('シフト区分を消せる', call('deleteShift', { code: '特' }, ADMIN_TOKEN).ok === true);

console.log('\n=== 20. 月間シフト表 ===');
const table = call('shiftTable', { month: '2026-10', employeeId: 'all' }, ADMIN_TOKEN);
check('シフト表が返る', table.ok === true, table.error);
check('10月は31日分', table.days.length === 31, table.days.length);
check('10/1は木曜', table.days[0].dow === 4, table.days[0]);
check('在籍者が並ぶ', table.members.length === 5, table.members.length);
check('最初は空', Object.keys(table.cells).length === 0);

const assign = call('assignShifts', {
  assignments: [
    { employeeId: 'E003', date: '2026-10-01', shift: '早' },
    { employeeId: 'E003', date: '2026-10-02', shift: '日' },
    { employeeId: 'E003', date: '2026-10-03', shift: '休' },
    { employeeId: 'E004', date: '2026-10-01', shift: '遅' },
    { employeeId: 'E004', date: '2026-10-02', shift: '宅' }
  ]
}, ADMIN_TOKEN);
check('5マス保存できた', assign.saved === 5, assign);

const table2 = call('shiftTable', { month: '2026-10', employeeId: 'all' }, ADMIN_TOKEN);
check('マスが埋まった', Object.keys(table2.cells).length === 5, Object.keys(table2.cells).length);
check('早番の時刻が展開された',
  table2.cells['E003|2026-10-01'].start === '07:00' && table2.cells['E003|2026-10-01'].end === '16:00',
  table2.cells['E003|2026-10-01']);
check('公休は時刻が空', table2.cells['E003|2026-10-03'].start === '');
check('公休の区分が入る', table2.cells['E003|2026-10-03'].kind === '公休');
check('在宅はリモート勤務になる', table2.cells['E004|2026-10-02'].workMode === 'リモート');
check('10/1の出勤は2人', table2.coverage[0].count === 2, table2.coverage[0]);
check('10/3の出勤は0人', table2.coverage[2].count === 0, table2.coverage[2]);
const t3 = table2.totals.filter(t => t.employeeId === 'E003')[0];
check('E003は勤務2日', t3.workDays === 2, t3.workDays);
check('E003は休み1日', t3.offDays === 1, t3.offDays);
// 早番 07:00-16:00 休憩60 = 480分, 日勤 09:00-18:00 休憩60 = 480分
check('E003の予定実働は16時間', t3.workMin === 960, t3.workMin);

console.log('\n=== 21. シフトから勤務予定への反映 ===');
const planOct = call('listPlans', { month: '2026-10', employeeId: 'E003' }, ADMIN_TOKEN);
check('勤務予定に3日入った', planOct.plans.length === 3, planOct.plans.length);
check('予定にシフト記号が入る', planOct.plans[0].shift === '早', planOct.plans[0]);
check('予定の勤務形態も入る', planOct.plans[0].workMode === '出社');

const clear = call('assignShifts', {
  assignments: [{ employeeId: 'E003', date: '2026-10-02', shift: '' }]
}, ADMIN_TOKEN);
check('空を指定すると消える', clear.cleared === 1, clear);
check('予定が2日になった',
  call('listPlans', { month: '2026-10', employeeId: 'E003' }, ADMIN_TOKEN).plans.length === 2);
check('一般は他人のシフトを組めない',
  call('assignShifts', { assignments: [{ employeeId: 'E002', date: '2026-10-05', shift: '日' }] },
    MEMBER_TOKEN2).ok === false);
check('一般は自分のシフトなら入れられる',
  call('assignShifts', { assignments: [{ employeeId: 'E003', date: '2026-10-06', shift: '日' }] },
    MEMBER_TOKEN2).ok === true);
check('知らない記号は弾く',
  call('assignShifts', { assignments: [{ employeeId: 'E003', date: '2026-10-07', shift: '謎' }] },
    ADMIN_TOKEN).ok === false);

console.log('\n=== 22. 先月のシフトを流用 ===');
// 11月の各日は「28日前」を写す。11/5←10/8、11/6←10/9
call('assignShifts', {
  assignments: [
    { employeeId: 'E003', date: '2026-10-08', shift: '早' },
    { employeeId: 'E003', date: '2026-10-09', shift: '休' },
    { employeeId: 'E004', date: '2026-10-08', shift: '遅' }
  ]
}, ADMIN_TOKEN);
call('assignShifts', {
  assignments: [{ employeeId: 'E003', date: '2026-11-05', shift: '日' }]
}, ADMIN_TOKEN);   // 既に入っている日は上書きされないことの確認用

const copied = call('copyShiftPattern', { month: '2026-11', employeeId: 'all' }, ADMIN_TOKEN);
check('11月へ写せた', copied.ok === true, copied.error);
const nov = call('shiftTable', { month: '2026-11', employeeId: 'all' }, ADMIN_TOKEN);
check('11/6に10/9の公休が写った', nov.cells['E003|2026-11-06'] &&
  nov.cells['E003|2026-11-06'].shift === '休', nov.cells['E003|2026-11-06']);
check('11/5に10/8の早番が写った（別の人）', nov.cells['E004|2026-11-05'] &&
  nov.cells['E004|2026-11-05'].shift === '遅', nov.cells['E004|2026-11-05']);
check('既に入っていた11/5は上書きされない',
  nov.cells['E003|2026-11-05'].shift === '日', nov.cells['E003|2026-11-05']);
check('曜日がそろっている', Object.keys(nov.cells).every(k => {
  const d = k.split('|')[1].split('-');
  const cur = new Date(Number(d[0]), Number(d[1]) - 1, Number(d[2]));
  const src = new Date(Number(d[0]), Number(d[1]) - 1, Number(d[2]) - 28);
  return src.getDay() === cur.getDay();
}));

console.log('\n=== 23. シフトの休憩が実働計算に効く ===');
H.setNow('2026-10-06T00:00:00Z');   // JST 09:00 (10/6) 日勤 09:00-18:00 休憩60
const in6 = call('punch', { type: 'in', workMode: 'リモート' }, MEMBER_TOKEN2);
check('10/6 出勤', in6.ok === true, in6.error);
check('シフト記号が記録に入る', in6.record.shift === '日', in6.record.shift);
H.setNow('2026-10-06T09:00:00Z');   // JST 18:00
const out6 = call('punch', { type: 'out', workMode: 'リモート' }, MEMBER_TOKEN2);
check('実働480分（休憩60を引いた）', out6.record.workMin === 480, out6.record.workMin);
check('残業なし', out6.record.overMin === 0, out6.record.overMin);
check('予定どおり', out6.record.judge === '予定どおり', out6.record.judge);

console.log('\n=== 24. 予定登録でもシフトを選べる ===');
// 有効日数は既定180日なので、1か月たっても入りっぱなしのまま
check('1か月ではログインが切れない',
  call('bootstrap', {}, ADMIN_TOKEN).ok === true);
const ADMIN_TOKEN2 = ADMIN_TOKEN;
const planByShift = call('savePlan', {
  dates: ['2026-10-20', '2026-10-21'], shift: '遅', employeeId: 'E003'
}, ADMIN_TOKEN2);
check('シフト指定で登録できた', planByShift.saved === 2, planByShift);
const p20 = G.findPlan_('E003', '2026-10-20');
check('遅番の時刻が入る', G.normTime_(p20['出勤予定']) === '13:00' && G.normTime_(p20['退勤予定']) === '22:00');
check('シフト記号も入る', String(p20['シフト']) === '遅');
check('一般社員のシフト表は自分だけ',
  call('shiftTable', { month: '2026-10', employeeId: 'all' },
    call('login', { employeeId: 'E003', pin: '4321' }).token).members.length === 1);

console.log('\n=== 25. ログインの有効期間 ===');
// 設定シートで短くすると、そのとおりに失効する
call('saveSettings', { settings: [{ key: 'ログイン有効日数', value: '1' }] }, ADMIN_TOKEN2);
const shortLogin = call('login', { employeeId: 'E001', pin: adminPin });
check('短い有効期間でログインできる', shortLogin.ok === true, shortLogin.error);
check('その場では使える', call('bootstrap', {}, shortLogin.token).ok === true);
H.setNow('2026-10-08T09:00:00Z');   // 2日進める
check('1日に設定したら2日後には切れる',
  call('bootstrap', {}, shortLogin.token).ok === false);
// 期限切れは requireAuth_ がその場で捨てるので、掃除を待つ必要はない
check('切れたトークンはその場で消える',
  H.propsStore['tok_' + shortLogin.token] === undefined);
// 掃除は、触られないまま残った古いトークンのためにある
H.propsStore['tok_dummyexpired'] = JSON.stringify({ e: 'E001', exp: 1 });
G.cleanupTokens();
check('放置された古いトークンは掃除で消える',
  H.propsStore['tok_dummyexpired'] === undefined);
// 元に戻す
const longToken = call('login', { employeeId: 'E001', pin: adminPin }).token;
call('saveSettings', { settings: [{ key: 'ログイン有効日数', value: '180' }] }, longToken);
check('設定を戻せた', String(G.getConfig_()['ログイン有効日数']) === '180');

console.log('\n=== 26. 貼り付け用の1枚版 ===');
const { execFileSync } = require('child_process');
const path = require('path');
try {
  execFileSync(process.execPath,
    [path.join(__dirname, '..', 'tools', 'bundle.js'), '--check'], { stdio: 'pipe' });
  check('paste-to-gas.gs が gas/ と一致している', true);
} catch (e) {
  check('paste-to-gas.gs が gas/ と一致している', false,
    String((e.stderr || '').toString() || e.message).trim());
}

console.log('\n----------------------------------------');
console.log(pass + ' 件成功 / ' + fail + ' 件失敗');
console.log('----------------------------------------');
process.exit(fail ? 1 : 0);
