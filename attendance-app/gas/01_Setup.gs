/**
 * 初期セットアップ
 *
 * Apps Script エディタで setup() を一度だけ実行する。
 *  1. スプレッドシートを用意し（無ければ新規作成）シートと見出しを作る
 *  2. 設定シートに初期値を書く
 *  3. 社員マスターに初期メンバーを登録し、PINを発行する
 *  4. アプリキー（フロントから叩くときの合言葉）を発行する
 *  5. 未打刻アラートなどの時間トリガーを設置する
 * 実行ログに「アプリキー」と「各人のPIN」が出るので控えること。
 */
function setup() {
  const ss = getSpreadsheet_();
  ensureSheets_(ss);
  seedConfig_(ss);
  const pins = seedEmployees_(ss);
  const key = ensureAppKey_();
  installTriggers();

  const lines = [];
  lines.push('==============================================');
  lines.push(APP_NAME + ' セットアップ完了');
  lines.push('==============================================');
  lines.push('スプレッドシート: ' + ss.getUrl());
  lines.push('アプリキー: ' + key);
  lines.push('');
  lines.push('■ 発行したPIN（本人にだけ伝えてください）');
  pins.forEach(function (p) {
    lines.push('  ' + p.name + ' … 社員ID: ' + p.id + ' / PIN: ' + p.pin);
  });
  lines.push('');
  lines.push('次にやること:');
  lines.push('  1. 社員マスターの氏名・メールアドレスを正しい内容に直す');
  lines.push('  2. 設定シートの事業所緯度・経度を入れる（GPS判定に使う）');
  lines.push('  3. デプロイ > 新しいデプロイ > ウェブアプリ');
  lines.push('     次のユーザーとして実行: 自分');
  lines.push('     アクセスできるユーザー: 全員');
  lines.push('  4. 出てきた /exec のURLとアプリキーをスマホアプリの初期設定に入れる');
  lines.push('==============================================');
  const msg = lines.join('\n');
  Logger.log(msg);
  return msg;
}

/** アプリキーだけ再発行したいとき */
function resetAppKey() {
  PropertiesService.getScriptProperties().deleteProperty(PROP_APP_KEY);
  const key = ensureAppKey_();
  Logger.log('新しいアプリキー: ' + key);
  return key;
}

/** 使用するスプレッドシートを返す（無ければ作る） */
function getSpreadsheet_() {
  const props = PropertiesService.getScriptProperties();
  const id = props.getProperty(PROP_SPREADSHEET_ID);
  if (id) {
    try {
      return SpreadsheetApp.openById(id);
    } catch (err) {
      // 消えていたら作り直す
    }
  }
  const active = SpreadsheetApp.getActiveSpreadsheet();
  if (active) {
    props.setProperty(PROP_SPREADSHEET_ID, active.getId());
    return active;
  }
  const created = SpreadsheetApp.create(APP_NAME + ' データベース');
  props.setProperty(PROP_SPREADSHEET_ID, created.getId());
  return created;
}

/** シートと見出し行を用意する */
function ensureSheets_(ss) {
  Object.keys(HEADERS).forEach(function (name) {
    let sh = ss.getSheetByName(name);
    if (!sh) sh = ss.insertSheet(name);
    const headers = HEADERS[name];
    const current = sh.getLastColumn() > 0
      ? sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0]
      : [];
    if (current.join('') !== headers.join('')) {
      sh.getRange(1, 1, 1, headers.length).setValues([headers]);
    }
    sh.getRange(1, 1, 1, headers.length)
      .setFontWeight('bold')
      .setBackground('#1f2a44')
      .setFontColor('#ffffff');
    sh.setFrozenRows(1);
    if (sh.getMaxColumns() > headers.length) {
      sh.deleteColumns(headers.length + 1, sh.getMaxColumns() - headers.length);
    }
  });
  const first = ss.getSheets()[0];
  if ((first.getName() === 'シート1' || first.getName() === 'Sheet1') && ss.getSheets().length > 1) {
    ss.deleteSheet(first);
  }
  ss.setSpreadsheetTimeZone(TZ);
}

/** 設定シートに初期値を書く（既にあるキーは触らない） */
function seedConfig_(ss) {
  const sh = ss.getSheetByName(SHEET_CONFIG);
  const existing = {};
  const last = sh.getLastRow();
  if (last > 1) {
    sh.getRange(2, 1, last - 1, 1).getValues().forEach(function (r) {
      existing[String(r[0])] = true;
    });
  }
  const rows = DEFAULT_CONFIG.filter(function (r) { return !existing[r[0]]; });
  if (rows.length) sh.getRange(sh.getLastRow() + 1, 1, rows.length, 3).setValues(rows);
  sh.setColumnWidth(1, 180);
  sh.setColumnWidth(2, 220);
  sh.setColumnWidth(3, 420);
}

/**
 * 初期メンバー。音声メモからの仮登録なので、
 * 氏名とメールアドレスはスプレッドシートかアプリの管理画面で直すこと。
 */
function seedEmployees_(ss) {
  const sh = ss.getSheetByName(SHEET_EMPLOYEE);
  if (sh.getLastRow() > 1) return [];   // 既に登録済みなら何もしない
  const seeds = [
    { name: '前岡 範行', kana: 'マエオカ ノリユキ', email: 'maeoka@fuchu-albatross.org', role: ROLE_ADMIN },
    { name: '上地', kana: 'カミジ', email: '', role: ROLE_MEMBER },
    { name: '柴原 和子', kana: 'シバハラ カズコ', email: '', role: ROLE_MEMBER },
    { name: '元木 明日香', kana: 'モトキ アスカ', email: '', role: ROLE_MEMBER },
    { name: '橋本', kana: 'ハシモト', email: '', role: ROLE_MEMBER }
  ];
  const now = new Date();
  const out = [];
  const rows = seeds.map(function (s, i) {
    const id = 'E' + ('000' + (i + 1)).slice(-3);
    const pin = String(Math.floor(1000 + Math.random() * 9000));
    out.push({ id: id, name: s.name, pin: pin });
    return [
      id, s.name, s.kana, s.email, pin, s.role,
      '09:00', '18:00', 60, true, '', '',
      '音声メモからの仮登録。氏名とメールを確認してください',
      now
    ];
  });
  sh.getRange(2, 1, rows.length, HEADERS[SHEET_EMPLOYEE].length).setValues(rows);
  return out;
}

/** アプリキー（フロントから API を叩くときの合言葉） */
function ensureAppKey_() {
  const props = PropertiesService.getScriptProperties();
  let key = props.getProperty(PROP_APP_KEY);
  if (!key) {
    key = Utilities.getUuid().replace(/-/g, '').slice(0, 24);
    props.setProperty(PROP_APP_KEY, key);
  }
  return key;
}
