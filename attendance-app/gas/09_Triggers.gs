/**
 * 時間トリガー
 *
 *  checkAlerts  … 10分おき。予定を過ぎても打刻がない人に声をかける
 *  dailyClose   … 毎日23:50。その日の未打刻を締める
 *  cleanupTokens… 毎日3時。期限切れのログイン情報を捨てる
 */

function installTriggers() {
  const names = ['checkAlerts', 'dailyClose', 'cleanupTokens'];
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (names.indexOf(t.getHandlerFunction()) >= 0) ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('checkAlerts').timeBased().everyMinutes(10).create();
  ScriptApp.newTrigger('dailyClose').timeBased().atHour(23).nearMinute(50).everyDays(1).create();
  ScriptApp.newTrigger('cleanupTokens').timeBased().atHour(3).everyDays(1).create();
  Logger.log('トリガーを設置しました');
}

/** 予定を過ぎても打刻がない人に通知する */
function checkAlerts() {
  const cfg = getConfig_();
  const date = today_();
  const nowMin = timeToMin_(fmtTime_(new Date()));
  const inGrace = configNum_(cfg, '未出勤アラート(分)', 15);
  const outGrace = configNum_(cfg, '未退勤アラート(分)', 60);

  const plans = readAll_(SHEET_PLAN).filter(function (p) { return normDate_(p['日付']) === date; });
  if (!plans.length) return;

  plans.forEach(function (p) {
    const kind = String(p['区分'] || '通常');
    if (kind === '有給' || kind === '公休' || kind === '特別休暇') return;

    const employeeId = String(p['社員ID']);
    const emp = employeeRowById_(employeeId);
    if (!emp || !isActive_(emp['在籍'])) return;

    let rec = findRecord_(employeeId, date);
    if (!rec) {
      createRecord_(emp, date, p);
      rec = findRecord_(employeeId, date);
    }

    const planIn = timeToMin_(p['出勤予定']);
    const planOut = timeToMin_(p['退勤予定']);
    const actIn = timeToMin_(rec['出勤実績']);
    const actOut = timeToMin_(rec['退勤実績']);

    if (planIn !== null && actIn === null && nowMin > planIn + inGrace && !rec['出勤アラート']) {
      notifyAlert_(emp, '未打刻 ' + String(emp['氏名']),
        '【未出勤】' + String(emp['氏名']) + ' さん\n' +
        date + ' の出勤予定 ' + normTime_(p['出勤予定']) + ' を ' +
        (nowMin - planIn) + '分過ぎましたが、出勤の打刻がありません。');
      updateRow_(SHEET_RECORD, rec._row, { '出勤アラート': fmtStamp_(new Date()) });
    }

    if (planOut !== null && actIn !== null && actOut === null &&
        nowMin > planOut + outGrace && !rec['退勤アラート']) {
      notifyAlert_(emp, '未退勤 ' + String(emp['氏名']),
        '【未退勤】' + String(emp['氏名']) + ' さん\n' +
        date + ' の退勤予定 ' + normTime_(p['退勤予定']) + ' を ' +
        (nowMin - planOut) + '分過ぎましたが、退勤の打刻がありません。');
      updateRow_(SHEET_RECORD, rec._row, { '退勤アラート': fmtStamp_(new Date()) });
    }
  });
}

/** その日の締め。予定があったのに打刻がなければ欠勤にする */
function dailyClose() {
  const date = today_();
  const cfg = getConfig_();
  const records = readAll_(SHEET_RECORD).filter(function (r) { return normDate_(r['日付']) === date; });

  records.forEach(function (r) {
    const actIn = timeToMin_(r['出勤実績']);
    const actOut = timeToMin_(r['退勤実績']);
    const planIn = timeToMin_(r['出勤予定']);
    const employeeId = String(r['社員ID']);

    if (actIn === null && planIn !== null && String(r['ステータス']) === ST_NONE) {
      updateRow_(SHEET_RECORD, r._row, { 'ステータス': ST_ABSENT, '更新日時': new Date() });
      recalcRecord_(employeeId, date, cfg);
    } else if (actIn !== null && actOut === null) {
      updateRow_(SHEET_RECORD, r._row, {
        '判定': '退勤打刻なし',
        '備考': [String(r['備考'] || ''), '退勤打刻がないまま日をまたぎました'].filter(String).join(' / '),
        '更新日時': new Date()
      });
      const emp = employeeRowById_(employeeId);
      if (emp) {
        notifyAlert_(emp, '退勤打刻なし ' + String(emp['氏名']),
          '【退勤打刻なし】' + String(emp['氏名']) + ' さん\n' +
          date + ' は出勤 ' + normTime_(r['出勤実績']) + ' のあと退勤の打刻がありませんでした。\n' +
          'スプレッドシートで実績を補記してください。');
      }
    }
  });
}
