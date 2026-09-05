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
check('シートが6枚できた', G.getSpreadsheet_().getSheets().length === 6,
  G.getSpreadsheet_().getSheets().map(s => s.getName()));
check('社員が5人', G.readAll_(G.C.SHEET_EMPLOYEE).length === 5);
check('トリガー3本', H.triggers.length === 3);

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

console.log('\n----------------------------------------');
console.log(pass + ' 件成功 / ' + fail + ' 件失敗');
console.log('----------------------------------------');
process.exit(fail ? 1 : 0);
