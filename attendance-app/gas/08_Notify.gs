/**
 * 通知
 *
 * 出退勤のステータスが変わったら、本人と管理者に知らせる。
 * 送り先はメールと Webhook（Slack / Google Chat / Discord）。
 * 設定シートの「メール通知」「Webhook URL」で切り替える。
 */

/** 打刻の通知 */
function notifyPunch_(emp, rec, type, cfg) {
  cfg = cfg || getConfig_();
  const isIn = type === 'in';
  const title = (isIn ? '出勤' : '退勤') + ' ' + String(emp['氏名']);
  const lines = [];
  lines.push('【' + (isIn ? '出勤' : '退勤') + '】' + String(emp['氏名']) + ' さん');
  lines.push(rec.date + ' ' + (isIn ? rec.inTime : rec.outTime) +
    '（' + (rec.workMode || '-') + '）');

  const planLabel = (rec.planStart || rec.planEnd)
    ? '予定 ' + (rec.planStart || '--:--') + '〜' + (rec.planEnd || '--:--')
    : '予定なし';
  lines.push(planLabel + ' / 判定 ' + (rec.judge || '-'));

  if (!isIn) {
    lines.push('実働 ' + minToLabel_(rec.workMin) +
      (rec.overMin > 0 ? '（うち残業 ' + minToLabel_(rec.overMin) + '）' : ''));
  }
  if (rec.lateMin > 0) lines.push('遅刻 ' + rec.lateMin + '分');
  if (rec.earlyMin > 0) lines.push('早退 ' + rec.earlyMin + '分');

  const place = isIn ? rec.inPlace : rec.outPlace;
  const dist = isIn ? rec.inDistance : rec.outDistance;
  if (place) {
    lines.push('場所 ' + place + (dist !== null && dist !== undefined ? '（事業所から約' + formatDistance_(dist) + '）' : ''));
  } else if (rec.workMode === MODE_REMOTE) {
    lines.push('場所 リモートのため未取得');
  }
  if (rec.deviceName) lines.push('端末 ' + rec.deviceName);

  const color = (rec.lateMin > 0 || rec.earlyMin > 0) ? COLOR_WARN : COLOR_OK;
  dispatch_(emp, title, lines.join('\n'), isIn ? '出勤打刻' : '退勤打刻', cfg, color);
}

/** 勤務予定の登録・変更・削除の通知 */
function notifyPlanChange_(emp, dates, start, end, kind, workMode, byName, deleted) {
  const cfg = getConfig_();
  if (!configOn_(cfg, '予定変更を通知', true)) return;
  if (!dates || !dates.length) return;

  const head = deleted ? '勤務予定を削除' : '勤務予定を登録';
  const lines = [];
  lines.push('【' + head + '】' + String(emp['氏名']) + ' さん');
  lines.push('対象日: ' + summarizeDates_(dates));
  if (kind && kind !== '通常') {
    lines.push('区分: ' + kind);
  } else {
    lines.push('時間: ' + (start || '--:--') + '〜' + (end || '--:--') + '（' + (workMode || '-') + '）');
  }
  lines.push('操作者: ' + byName);
  dispatch_(emp, head + ' ' + String(emp['氏名']), lines.join('\n'), head, cfg, COLOR_INFO);
}

/** 未打刻アラートなど */
function notifyAlert_(emp, title, body) {
  dispatch_(emp, title, body, 'アラート', getConfig_(), COLOR_ALERT);
}

/** 社員の追加など、特定の個人に紐づかない連絡 */
function notifySimple_(title, body, kind) {
  dispatch_(null, title, body, kind || 'お知らせ', getConfig_());
}

/** 実際に送る。宛先は「本人」と「管理者全員」 */
function dispatch_(emp, subject, body, kind, cfg, color) {
  cfg = cfg || getConfig_();
  const to = [];
  if (emp && configOn_(cfg, '本人へ通知', true)) {
    const e = String(emp['メールアドレス'] || '').trim();
    if (e) to.push(e);
  }
  if (configOn_(cfg, '管理者へ通知', true)) {
    readAll_(SHEET_EMPLOYEE).forEach(function (r) {
      if (String(r['権限']) !== ROLE_ADMIN || !isActive_(r['在籍'])) return;
      const e = String(r['メールアドレス'] || '').trim();
      if (e && to.indexOf(e) < 0) to.push(e);
    });
  }

  let result = [];
  if (configOn_(cfg, 'メール通知', true) && to.length) {
    try {
      MailApp.sendEmail({
        to: to.join(','),
        subject: '[' + APP_NAME + '] ' + subject,
        body: body + '\n\n--\n' + APP_NAME
      });
      result.push('メール ' + to.length + '件');
    } catch (err) {
      result.push('メール失敗: ' + err);
    }
  }

  const hook = String(cfg['Webhook URL'] || '').trim();
  if (hook) {
    try {
      postWebhook_(hook, body, { title: subject, color: color || COLOR_INFO });
      result.push('Webhook OK');
    } catch (err) {
      result.push('Webhook失敗: ' + err);
    }
  }

  logNotify_(kind, emp, body, to.join(','), result.join(' / ') || '送信先なし');
}

/**
 * Webhookに投げる。送り先によって形が違うので合わせる。
 *  Slack   … 左に色帯を出したいので attachments
 *  Discord … content でないと受け取らない
 *  それ以外（Google Chat など）… text
 */
function postWebhook_(url, text, opts) {
  opts = opts || {};
  let payload;
  if (/discord(app)?\.com/.test(url)) {
    payload = { content: text };
  } else if (/hooks\.slack\.com/.test(url)) {
    payload = {
      text: opts.title || String(text).split('\n')[0],
      attachments: [{
        color: opts.color || COLOR_INFO,
        blocks: [{ type: 'section', text: { type: 'mrkdwn', text: text } }]
      }]
    };
  } else {
    payload = { text: text };
  }

  const res = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });
  const code = res.getResponseCode ? res.getResponseCode() : 200;
  if (code >= 300) {
    throw new Error('Webhookが ' + code + ' を返しました: ' +
      String(res.getContentText ? res.getContentText() : '').slice(0, 120));
  }
}

/**
 * 通知の設定を確かめる。Apps Script のエディタから実行すると
 * 管理者あてにテストのメールとWebhookが1通ずつ飛ぶ。
 */
function testNotify() {
  const cfg = getConfig_();
  const hook = String(cfg['Webhook URL'] || '').trim();
  const lines = [
    '【テスト送信】' + APP_NAME,
    '通知の設定を確かめるために送っています。',
    'これが届いていれば、打刻や未打刻アラートも同じ経路で届きます。',
    '送信時刻: ' + fmtStamp_(new Date())
  ];
  dispatch_(null, '通知テスト', lines.join('\n'), 'テスト', cfg, COLOR_OK);

  const msg = [
    'メール通知: ' + (configOn_(cfg, 'メール通知', true) ? 'ON' : 'OFF'),
    'Webhook: ' + (hook ? hook.replace(/\/[^/]+$/, '/****') : '未設定'),
    '結果は通知ログシートに残ります。'
  ].join('\n');
  Logger.log(msg);
  return msg;
}

function logNotify_(kind, emp, body, to, result) {
  try {
    appendRow_(SHEET_NOTIFY, {
      '日時': new Date(),
      '種別': kind,
      '社員ID': emp ? String(emp['社員ID']) : '',
      '氏名': emp ? String(emp['氏名']) : '',
      '本文': body,
      '宛先': to,
      '結果': result
    });
  } catch (err) {
    Logger.log('通知ログの書き込みに失敗: ' + err);
  }
}

function formatDistance_(m) {
  const n = Number(m);
  if (isNaN(n)) return '-';
  return n >= 1000 ? (Math.round(n / 100) / 10) + 'km' : n + 'm';
}

/** 連続した日付を「9/1〜9/5」のようにまとめる */
function summarizeDates_(dates) {
  const sorted = dates.slice().sort();
  if (sorted.length <= 3) {
    return sorted.map(function (d) { return d.slice(5).replace('-', '/'); }).join('、');
  }
  return sorted[0].slice(5).replace('-', '/') + '〜' +
    sorted[sorted.length - 1].slice(5).replace('-', '/') +
    '（' + sorted.length + '日分）';
}
