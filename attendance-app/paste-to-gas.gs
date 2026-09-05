/**
 * 未来創造家 勤怠アプリ ─ Apps Script に貼る用の1枚版
 *
 * attendance-app/gas/ の全ファイルをつなげたもの。
 * 直接編集しないこと。直すときは gas/ の中を直して
 *   node attendance-app/tools/bundle.js
 * で作り直す。
 *
 * 収録: 00_Config.gs, 01_Setup.gs, 02_Store.gs, 03_Auth.gs, 04_Api.gs, 05_Attendance.gs, 06_Admin.gs, 07_Stats.gs, 08_Notify.gs, 09_Triggers.gs, 10_Shift.gs
 */

/* ============================================================
   00_Config.gs
   ============================================================ */

/**
 * 未来創造家 勤怠アプリ ─ 定数とシート定義
 *
 * スプレッドシート1冊を「データベース」として使う。
 * シートの列は下の HEADERS で定義した順に並ぶ。列を手で入れ替えないこと。
 */

const APP_NAME = '未来創造家 勤怠';
const APP_VERSION = '1.1.0';
const TZ = 'Asia/Tokyo';

/** シート名 */
const SHEET_EMPLOYEE = '社員マスター';
const SHEET_PLAN = '勤務予定';
const SHEET_RECORD = '出退勤記録';
const SHEET_DEVICE = '端末';
const SHEET_NOTIFY = '通知ログ';
const SHEET_CONFIG = '設定';
const SHEET_SHIFT = 'シフト区分';

/** 各シートの見出し行 */
const HEADERS = {
  '社員マスター': [
    '社員ID', '氏名', 'カナ', 'メールアドレス', 'PIN', '権限',
    '標準出勤', '標準退勤', '所定休憩(分)', '在籍', '入社日', '退社日', 'メモ', '更新日時'
  ],
  '勤務予定': [
    '予定ID', '日付', '社員ID', '氏名', 'シフト', '出勤予定', '退勤予定',
    '勤務形態', '区分', 'メモ', '登録者', '更新日時'
  ],
  'シフト区分': [
    '記号', '名称', '開始', '終了', '休憩(分)', '勤務形態', '区分', '色', '並び順', '有効'
  ],
  '出退勤記録': [
    '記録ID', '日付', '社員ID', '氏名', 'シフト',
    '出勤予定', '退勤予定',
    '出勤実績', '退勤実績',
    'ステータス', '判定',
    '遅刻(分)', '早退(分)', '休憩(分)', '実働(分)', '残業(分)',
    '勤務形態',
    '出勤場所', '出勤緯度', '出勤経度', '出勤精度(m)', '出勤事業所距離(m)',
    '退勤場所', '退勤緯度', '退勤経度', '退勤精度(m)', '退勤事業所距離(m)',
    '端末名', '端末ID',
    '出勤アラート', '退勤アラート', '備考', '更新日時'
  ],
  '端末': [
    '端末ID', '社員ID', '氏名', '端末名', 'プラットフォーム', 'UA', '初回登録', '最終利用'
  ],
  '通知ログ': [
    '日時', '種別', '社員ID', '氏名', '本文', '宛先', '結果'
  ],
  '設定': ['キー', '値', '説明']
};

/** 設定シートの初期値 */
const DEFAULT_CONFIG = [
  ['事業所名', '本社', 'GPS判定に使う拠点の名前'],
  ['事業所緯度', '', '例: 34.567890（空なら距離判定をしない）'],
  ['事業所経度', '', '例: 135.123456'],
  ['事業所半径(m)', '300', 'この距離以内なら「事業所内」と判定'],
  ['遅刻猶予(分)', '5', 'この分数までの遅れは遅刻としない'],
  ['未出勤アラート(分)', '15', '出勤予定を何分過ぎたら未打刻アラートを出すか'],
  ['未退勤アラート(分)', '60', '退勤予定を何分過ぎたら未打刻アラートを出すか'],
  ['自動休憩(分)', '60', '実働がこの下の時間を超えたら差し引く休憩'],
  ['自動休憩の基準(時間)', '6', '実働がこの時間を超えたら自動休憩を差し引く'],
  ['メール通知', 'ON', 'ON / OFF'],
  ['管理者へ通知', 'ON', '打刻のたびに管理者へも通知するか'],
  ['本人へ通知', 'ON', '打刻した本人へも通知するか'],
  ['Webhook URL', '', 'Slack / Google Chat / Discord の受信Webhook（任意）'],
  ['予定変更を通知', 'ON', '勤務予定の登録・変更・削除を通知するか']
];

/** シフト区分の初期値。運用しながらアプリの管理画面で足し引きできる */
const DEFAULT_SHIFTS = [
  ['早', '早番', '07:00', '16:00', 60, '出社', '通常', '#2f6fed', 1, true],
  ['日', '日勤', '09:00', '18:00', 60, '出社', '通常', '#12a06a', 2, true],
  ['遅', '遅番', '13:00', '22:00', 60, '出社', '通常', '#d4a017', 3, true],
  ['宅', '在宅', '09:00', '18:00', 60, 'リモート', '通常', '#7a5af0', 4, true],
  ['外', '外勤', '09:00', '18:00', 60, '外出・直行直帰', '通常', '#e0642f', 5, true],
  ['半', '半休(午前)', '13:00', '18:00', 0, '出社', '半休', '#0f9bb5', 6, true],
  ['休', '公休', '', '', 0, '出社', '公休', '#9aa3b4', 7, true],
  ['有', '有給', '', '', 0, '出社', '有給', '#6b7689', 8, true]
];

/** ステータス */
const ST_NONE = '未出勤';
const ST_WORKING = '出勤中';
const ST_DONE = '退勤済';
const ST_ABSENT = '欠勤';
const ST_OFF = '休暇';

/** 勤務形態 */
const MODE_OFFICE = '出社';
const MODE_REMOTE = 'リモート';
const MODE_FIELD = '外出・直行直帰';
const WORK_MODES = [MODE_OFFICE, MODE_REMOTE, MODE_FIELD];

/** 予定の区分 */
const PLAN_KINDS = ['通常', '半休', '有給', '公休', '特別休暇'];

/** 権限 */
const ROLE_ADMIN = '管理者';
const ROLE_MEMBER = '一般';

/** Script Properties のキー */
const PROP_SPREADSHEET_ID = 'SPREADSHEET_ID';
const PROP_APP_KEY = 'APP_KEY';
const PROP_TOKEN_PREFIX = 'tok_';

/** ログイントークンの有効日数 */
const TOKEN_DAYS = 30;

/* ============================================================
   01_Setup.gs
   ============================================================ */

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
  seedShifts_(ss);
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
  lines.push('  （シフト区分シートに早番・日勤・遅番などの初期値が入っています）');
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

/** シフト区分の初期値（既に1行でもあれば触らない） */
function seedShifts_(ss) {
  const sh = ss.getSheetByName(SHEET_SHIFT);
  if (sh.getLastRow() > 1) return;
  sh.getRange(2, 1, DEFAULT_SHIFTS.length, HEADERS[SHEET_SHIFT].length).setValues(DEFAULT_SHIFTS);
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

/* ============================================================
   02_Store.gs
   ============================================================ */

/**
 * スプレッドシートの読み書きと、日付・時刻まわりの小道具
 *
 * 行は「見出し名をキーにしたオブジェクト」で扱う。
 * 列を増やしたいときは HEADERS に足して setup() を再実行すればよい。
 */

function sheet_(name) {
  const ss = getSpreadsheet_();
  const sh = ss.getSheetByName(name);
  if (!sh) throw new Error('シートがありません: ' + name + '（setup() を実行してください）');
  return sh;
}

/** シート全体を {行番号, 各列} の配列で返す */
function readAll_(name) {
  const sh = sheet_(name);
  const last = sh.getLastRow();
  const headers = HEADERS[name];
  if (last < 2) return [];
  const values = sh.getRange(2, 1, last - 1, headers.length).getValues();
  return values.map(function (row, i) {
    const o = { _row: i + 2 };
    headers.forEach(function (h, c) { o[h] = row[c]; });
    return o;
  }).filter(function (o) {
    // 完全な空行は除く（1列目が空）
    return String(o[headers[0]]).length > 0;
  });
}

/** オブジェクトを1行追記する */
function appendRow_(name, obj) {
  const sh = sheet_(name);
  const headers = HEADERS[name];
  const row = headers.map(function (h) {
    return obj[h] === undefined || obj[h] === null ? '' : obj[h];
  });
  sh.appendRow(row);
  return sh.getLastRow();
}

/** 指定行を、渡されたキーの列だけ書き換える */
function updateRow_(name, rowIndex, obj) {
  const sh = sheet_(name);
  const headers = HEADERS[name];
  headers.forEach(function (h, c) {
    if (Object.prototype.hasOwnProperty.call(obj, h)) {
      sh.getRange(rowIndex, c + 1).setValue(obj[h] === null ? '' : obj[h]);
    }
  });
}

function deleteRow_(name, rowIndex) {
  sheet_(name).deleteRow(rowIndex);
}

/** 設定シートを {キー: 値} で返す */
function getConfig_() {
  const rows = readAll_(SHEET_CONFIG);
  const map = {};
  rows.forEach(function (r) { map[String(r['キー'])] = r['値']; });
  return map;
}

function configNum_(cfg, key, fallback) {
  const v = cfg[key];
  if (v === '' || v === null || v === undefined) return fallback;
  const n = Number(v);
  return isNaN(n) ? fallback : n;
}

function configOn_(cfg, key, fallback) {
  const v = cfg[key];
  if (v === '' || v === null || v === undefined) return fallback;
  return String(v).toUpperCase() === 'ON' || v === true || String(v) === 'TRUE';
}

/* ---------- 日付・時刻 ---------- */

function now_() { return new Date(); }

/** Date → 'yyyy-MM-dd' */
function fmtDate_(d) {
  return Utilities.formatDate(d, TZ, 'yyyy-MM-dd');
}

/** Date → 'HH:mm' */
function fmtTime_(d) {
  return Utilities.formatDate(d, TZ, 'HH:mm');
}

function fmtStamp_(d) {
  return Utilities.formatDate(d, TZ, 'yyyy-MM-dd HH:mm:ss');
}

function today_() { return fmtDate_(new Date()); }

/**
 * セルの値を 'yyyy-MM-dd' に正規化する。
 * スプレッドシートで日付として入力されると Date が返ってくるため。
 */
function normDate_(v) {
  if (v instanceof Date) return fmtDate_(v);
  const s = String(v || '').trim();
  const m = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (!m) return s;
  return m[1] + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[3]).slice(-2);
}

/** セルの値を 'HH:mm' に正規化する */
function normTime_(v) {
  if (v instanceof Date) return fmtTime_(v);
  const s = String(v || '').trim();
  if (!s) return '';
  const m = s.match(/^(\d{1,2}):(\d{2})/);
  if (!m) return s;
  return ('0' + m[1]).slice(-2) + ':' + m[2];
}

/** 'HH:mm' → 0時からの分。空なら null */
function timeToMin_(t) {
  const s = normTime_(t);
  const m = s.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

/** 分 → 'H時間M分' */
function minToLabel_(min) {
  if (min === null || min === undefined || min === '') return '';
  const n = Math.max(0, Math.round(Number(min)));
  const h = Math.floor(n / 60);
  const m = n % 60;
  return (h ? h + '時間' : '') + m + '分';
}

/** 'yyyy-MM' の月初・月末を返す */
function monthRange_(month) {
  const m = String(month).match(/^(\d{4})-(\d{1,2})$/);
  if (!m) throw new Error('月の指定が不正です: ' + month);
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const first = new Date(y, mo - 1, 1);
  const last = new Date(y, mo, 0);
  return { from: fmtDate_(first), to: fmtDate_(last), days: last.getDate() };
}

function uid_(prefix) {
  return prefix + Utilities.formatDate(new Date(), TZ, 'yyyyMMddHHmmss') +
    Math.floor(Math.random() * 1000);
}

/** 2点間の距離(m)。Hubenyではなく素直なHaversine */
function distanceMeters_(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const toRad = function (d) { return d * Math.PI / 180; };
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
    Math.sin(dLng / 2) * Math.sin(dLng / 2);
  return Math.round(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

/** 緯度経度から住所を引く。失敗しても打刻は止めない */
function reverseGeocode_(lat, lng) {
  try {
    const res = Maps.newGeocoder().setLanguage('ja').reverseGeocode(lat, lng);
    if (res && res.results && res.results.length) {
      return String(res.results[0].formatted_address).replace(/^日本、?\s*/, '');
    }
  } catch (err) {
    Logger.log('逆ジオコーディング失敗: ' + err);
  }
  return '';
}

/* ============================================================
   03_Auth.gs
   ============================================================ */

/**
 * 認証
 *
 * スマホから使うので Google ログインは前提にしない。
 * 「社員を選ぶ + 4桁PIN」でログインし、あとはトークンで通す。
 * トークンは Script Properties に置き、30日で失効する。
 */

/** ログイン画面に出す社員の一覧（氏名だけ。PINやメールは返さない） */
function listPublicMembers_() {
  return readAll_(SHEET_EMPLOYEE)
    .filter(function (r) { return isActive_(r['在籍']); })
    .map(function (r) {
      return { id: String(r['社員ID']), name: String(r['氏名']) };
    });
}

function isActive_(v) {
  if (v === true) return true;
  const s = String(v).trim().toUpperCase();
  return s === 'TRUE' || s === '○' || s === '在籍' || s === '1' || s === 'ON' || s === 'はい';
}

function employeeRowById_(id) {
  const rows = readAll_(SHEET_EMPLOYEE);
  for (let i = 0; i < rows.length; i++) {
    if (String(rows[i]['社員ID']) === String(id)) return rows[i];
  }
  return null;
}

/** 外に出してよい社員情報だけに絞る */
function publicEmployee_(row) {
  return {
    id: String(row['社員ID']),
    name: String(row['氏名']),
    kana: String(row['カナ'] || ''),
    email: String(row['メールアドレス'] || ''),
    role: String(row['権限'] || ROLE_MEMBER),
    isAdmin: String(row['権限']) === ROLE_ADMIN,
    defaultStart: normTime_(row['標準出勤']) || '09:00',
    defaultEnd: normTime_(row['標準退勤']) || '18:00',
    breakMin: Number(row['所定休憩(分)'] || 0),
    active: isActive_(row['在籍'])
  };
}

/** PINでログインしてトークンを発行する */
function login_(employeeId, pin) {
  const cache = CacheService.getScriptCache();
  const lockKey = 'fail_' + employeeId;
  const fails = Number(cache.get(lockKey) || 0);
  if (fails >= 8) {
    throw new Error('PINの入力を続けて間違えました。10分ほど待ってからお試しください。');
  }

  const row = employeeRowById_(employeeId);
  if (!row) throw new Error('社員が見つかりません。');
  if (!isActive_(row['在籍'])) throw new Error('この社員は在籍中ではありません。管理者にご連絡ください。');

  const expected = String(row['PIN'] || '').trim();
  if (!expected) throw new Error('PINが未設定です。管理者にPINを設定してもらってください。');
  if (String(pin || '').trim() !== expected) {
    cache.put(lockKey, String(fails + 1), 600);
    throw new Error('PINが違います。');
  }
  cache.remove(lockKey);

  const token = Utilities.getUuid().replace(/-/g, '');
  const exp = Date.now() + TOKEN_DAYS * 24 * 60 * 60 * 1000;
  PropertiesService.getScriptProperties()
    .setProperty(PROP_TOKEN_PREFIX + token, JSON.stringify({ e: String(employeeId), exp: exp }));

  return { token: token, employee: publicEmployee_(row) };
}

/** トークンから社員を引く。無効なら例外 */
function requireAuth_(token) {
  if (!token) throw new Error('ログインが必要です。');
  const props = PropertiesService.getScriptProperties();
  const raw = props.getProperty(PROP_TOKEN_PREFIX + token);
  if (!raw) throw new Error('ログインの有効期限が切れました。もう一度ログインしてください。');
  let data;
  try { data = JSON.parse(raw); } catch (err) { throw new Error('ログイン情報が壊れています。'); }
  if (!data.exp || data.exp < Date.now()) {
    props.deleteProperty(PROP_TOKEN_PREFIX + token);
    throw new Error('ログインの有効期限が切れました。もう一度ログインしてください。');
  }
  const row = employeeRowById_(data.e);
  if (!row) throw new Error('社員が見つかりません。');
  if (!isActive_(row['在籍'])) throw new Error('この社員は在籍中ではありません。');
  return { row: row, employee: publicEmployee_(row), token: token };
}

function requireAdmin_(auth) {
  if (!auth.employee.isAdmin) throw new Error('この操作は管理者のみ行えます。');
  return auth;
}

function logout_(token) {
  if (token) PropertiesService.getScriptProperties().deleteProperty(PROP_TOKEN_PREFIX + token);
  return { ok: true };
}

/** 期限切れトークンの掃除（日次トリガーから呼ぶ） */
function cleanupTokens() {
  const props = PropertiesService.getScriptProperties();
  const all = props.getProperties();
  const now = Date.now();
  let removed = 0;
  Object.keys(all).forEach(function (k) {
    if (k.indexOf(PROP_TOKEN_PREFIX) !== 0) return;
    try {
      const d = JSON.parse(all[k]);
      if (!d.exp || d.exp < now) { props.deleteProperty(k); removed++; }
    } catch (err) {
      props.deleteProperty(k);
      removed++;
    }
  });
  Logger.log('期限切れトークンを ' + removed + ' 件削除しました');
}

/** アプリキーの照合 */
function checkAppKey_(key) {
  const expected = PropertiesService.getScriptProperties().getProperty(PROP_APP_KEY);
  if (!expected) return;  // まだ発行していないなら素通し
  if (String(key || '') !== expected) throw new Error('アプリキーが違います。初期設定を確認してください。');
}

/* ============================================================
   04_Api.gs
   ============================================================ */

/**
 * Web API の入口
 *
 * フロント（GitHub Pages に置いた PWA）から次の形で叩く。
 *   POST <exec URL>
 *   Content-Type: text/plain     ← プリフライトを起こさないため
 *   本文: {"action":"punch","appKey":"...","token":"...","payload":{...}}
 *
 * 会社のネットワークなどで POST が通らないときのために
 *   GET <exec URL>?p=<JSONをURIエンコードしたもの>&callback=cb
 * の JSONP でも同じことができる。
 */

function doPost(e) {
  let req = {};
  try {
    req = JSON.parse((e && e.postData && e.postData.contents) || '{}');
  } catch (err) {
    return jsonOut_({ ok: false, error: 'リクエストの形式が不正です。' });
  }
  return jsonOut_(handle_(req));
}

function doGet(e) {
  const p = e && e.parameter ? e.parameter : {};
  let req;
  if (p.p) {
    try { req = JSON.parse(p.p); } catch (err) { req = null; }
    if (!req) {
      const body = { ok: false, error: 'リクエストの形式が不正です。' };
      return p.callback ? jsonpOut_(p.callback, body) : jsonOut_(body);
    }
  } else {
    req = { action: p.action || 'ping', appKey: p.appKey, token: p.token, payload: {} };
  }
  const result = handle_(req);
  return p.callback ? jsonpOut_(p.callback, result) : jsonOut_(result);
}

function jsonOut_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function jsonpOut_(callback, obj) {
  const safe = String(callback).replace(/[^A-Za-z0-9_$.]/g, '');
  return ContentService.createTextOutput(safe + '(' + JSON.stringify(obj) + ');')
    .setMimeType(ContentService.MimeType.JAVASCRIPT);
}

/** action ごとの振り分け */
function handle_(req) {
  const action = String(req.action || '');
  const payload = req.payload || {};
  try {
    // アプリキーの要らない唯一の口。疎通確認用
    if (action === 'ping') {
      return ok_({ app: APP_NAME, version: APP_VERSION, time: fmtStamp_(new Date()) });
    }

    checkAppKey_(req.appKey);

    switch (action) {
      case 'members':
        return ok_({ members: listPublicMembers_() });

      case 'login':
        return ok_(login_(payload.employeeId, payload.pin));

      case 'logout':
        return ok_(logout_(req.token));
    }

    const auth = requireAuth_(req.token);

    switch (action) {
      case 'bootstrap':
        return ok_(bootstrap_(auth));

      case 'punch':
        return ok_(withLock_(function () { return punch_(auth, payload); }));

      case 'savePlan':
        return ok_(withLock_(function () { return savePlan_(auth, payload); }));

      case 'deletePlan':
        return ok_(withLock_(function () { return deletePlan_(auth, payload); }));

      case 'shiftTable':
        return ok_(shiftTable_(auth, payload));

      case 'assignShifts':
        return ok_(withLock_(function () { return assignShifts_(auth, payload); }));

      case 'copyShiftPattern':
        return ok_(withLock_(function () { return copyShiftPattern_(auth, payload); }));

      case 'listShifts':
        return ok_({ shifts: listShifts_(false) });

      case 'listPlans':
        return ok_({ plans: listPlans_(auth, payload) });

      case 'listRecords':
        return ok_({ records: listRecords_(auth, payload) });

      case 'stats':
        return ok_(stats_(auth, payload));

      case 'registerDevice':
        return ok_(registerDevice_(auth, payload));

      case 'changePin':
        return ok_(changePin_(auth, payload));

      // ---- ここから管理者専用 ----
      case 'listEmployees':
        return ok_({ employees: listEmployees_(requireAdmin_(auth)) });

      case 'saveEmployee':
        return ok_(withLock_(function () { return saveEmployee_(requireAdmin_(auth), payload); }));

      case 'retireEmployee':
        return ok_(withLock_(function () { return retireEmployee_(requireAdmin_(auth), payload); }));

      case 'getSettings':
        return ok_({ settings: getSettings_(requireAdmin_(auth)) });

      case 'saveSettings':
        return ok_(saveSettings_(requireAdmin_(auth), payload));

      case 'saveShift':
        return ok_(saveShift_(requireAdmin_(auth), payload));

      case 'deleteShift':
        return ok_(deleteShift_(requireAdmin_(auth), payload));

      case 'listDevices':
        return ok_({ devices: listDevices_(requireAdmin_(auth)) });

      default:
        return { ok: false, error: '不明な操作です: ' + action };
    }
  } catch (err) {
    return { ok: false, error: String(err && err.message ? err.message : err) };
  }
}

function ok_(data) {
  const o = { ok: true };
  Object.keys(data || {}).forEach(function (k) { o[k] = data[k]; });
  return o;
}

/** 同時打刻で行が二重になるのを防ぐ */
function withLock_(fn) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) throw new Error('混み合っています。少し待ってからもう一度お試しください。');
  try {
    return fn();
  } finally {
    lock.releaseLock();
  }
}

/** アプリ起動時にひと通り返す */
function bootstrap_(auth) {
  const cfg = getConfig_();
  const date = today_();
  const rec = findRecord_(auth.employee.id, date);
  const plan = findPlan_(auth.employee.id, date);
  const from = date;
  const to = fmtDate_(new Date(Date.now() + 30 * 24 * 60 * 60 * 1000));
  return {
    employee: auth.employee,
    today: {
      date: date,
      plan: plan ? planToJson_(plan) : null,
      record: rec ? recordToJson_(rec) : null,
      status: rec ? String(rec['ステータス'] || ST_NONE) : ST_NONE
    },
    upcomingPlans: listPlans_(auth, { from: from, to: to, employeeId: auth.employee.id }),
    workModes: WORK_MODES,
    planKinds: PLAN_KINDS,
    shifts: listShifts_(false),
    office: {
      name: String(cfg['事業所名'] || ''),
      lat: cfg['事業所緯度'] === '' ? null : Number(cfg['事業所緯度']),
      lng: cfg['事業所経度'] === '' ? null : Number(cfg['事業所経度']),
      radius: configNum_(cfg, '事業所半径(m)', 300)
    },
    members: auth.employee.isAdmin ? listPublicMembers_() : [],
    serverTime: fmtStamp_(new Date()),
    version: APP_VERSION
  };
}

/* ============================================================
   05_Attendance.gs
   ============================================================ */

/**
 * 勤務予定と出退勤の本体
 *
 * ・勤務予定 … いつ出勤して、いつ退勤する「つもり」か
 * ・出退勤記録 … 実際に何時に打刻したか。予定と突き合わせて判定を入れる
 * 1日1人につき記録は1行。日付 + 社員ID で引く。
 */

/* ---------- 取得 ---------- */

function findPlan_(employeeId, date) {
  const rows = readAll_(SHEET_PLAN);
  for (let i = 0; i < rows.length; i++) {
    if (String(rows[i]['社員ID']) === String(employeeId) &&
        normDate_(rows[i]['日付']) === date) return rows[i];
  }
  return null;
}

function findRecord_(employeeId, date) {
  const rows = readAll_(SHEET_RECORD);
  for (let i = 0; i < rows.length; i++) {
    if (String(rows[i]['社員ID']) === String(employeeId) &&
        normDate_(rows[i]['日付']) === date) return rows[i];
  }
  return null;
}

function planToJson_(p) {
  return {
    id: String(p['予定ID']),
    date: normDate_(p['日付']),
    employeeId: String(p['社員ID']),
    name: String(p['氏名']),
    shift: String(p['シフト'] || ''),
    start: normTime_(p['出勤予定']),
    end: normTime_(p['退勤予定']),
    workMode: String(p['勤務形態'] || MODE_OFFICE),
    kind: String(p['区分'] || '通常'),
    note: String(p['メモ'] || '')
  };
}

function recordToJson_(r) {
  return {
    id: String(r['記録ID']),
    date: normDate_(r['日付']),
    employeeId: String(r['社員ID']),
    name: String(r['氏名']),
    shift: String(r['シフト'] || ''),
    planStart: normTime_(r['出勤予定']),
    planEnd: normTime_(r['退勤予定']),
    inTime: normTime_(r['出勤実績']),
    outTime: normTime_(r['退勤実績']),
    status: String(r['ステータス'] || ST_NONE),
    judge: String(r['判定'] || ''),
    lateMin: Number(r['遅刻(分)'] || 0),
    earlyMin: Number(r['早退(分)'] || 0),
    breakMin: Number(r['休憩(分)'] || 0),
    workMin: Number(r['実働(分)'] || 0),
    overMin: Number(r['残業(分)'] || 0),
    workMode: String(r['勤務形態'] || ''),
    inPlace: String(r['出勤場所'] || ''),
    inLat: r['出勤緯度'] === '' ? null : Number(r['出勤緯度']),
    inLng: r['出勤経度'] === '' ? null : Number(r['出勤経度']),
    inDistance: r['出勤事業所距離(m)'] === '' ? null : Number(r['出勤事業所距離(m)']),
    outPlace: String(r['退勤場所'] || ''),
    outLat: r['退勤緯度'] === '' ? null : Number(r['退勤緯度']),
    outLng: r['退勤経度'] === '' ? null : Number(r['退勤経度']),
    outDistance: r['退勤事業所距離(m)'] === '' ? null : Number(r['退勤事業所距離(m)']),
    deviceName: String(r['端末名'] || ''),
    deviceId: String(r['端末ID'] || ''),
    note: String(r['備考'] || '')
  };
}

/* ---------- 勤務予定 ---------- */

/**
 * 予定の登録・更新。日付をまとめて渡せるので、
 * 「来週の月〜金を9:00-18:00で」といった入れ方が1回で済む。
 */
function savePlan_(auth, payload) {
  const targetId = resolveTargetEmployee_(auth, payload.employeeId);
  const emp = employeeRowById_(targetId);
  if (!emp) throw new Error('社員が見つかりません。');

  const dates = (payload.dates || []).map(normDate_).filter(function (d) {
    return /^\d{4}-\d{2}-\d{2}$/.test(d);
  });
  if (!dates.length) throw new Error('日付が指定されていません。');

  // シフト区分を指定されたら、時刻も勤務形態も区分もそこから取る
  const shift = payload.shift ? findShift_(payload.shift) : null;
  if (payload.shift && !shift) throw new Error('シフト区分が見つかりません: ' + payload.shift);

  const kind = shift ? shift.kind
    : (PLAN_KINDS.indexOf(payload.kind) >= 0 ? payload.kind : '通常');
  const isHoliday = (kind === '有給' || kind === '公休' || kind === '特別休暇');
  const start = isHoliday ? '' : normTime_(shift ? shift.start : (payload.start || emp['標準出勤']));
  const end = isHoliday ? '' : normTime_(shift ? shift.end : (payload.end || emp['標準退勤']));
  if (!isHoliday) {
    if (!timeToMin_(start) && timeToMin_(start) !== 0) throw new Error('出勤予定の時刻が不正です。');
    if (!timeToMin_(end) && timeToMin_(end) !== 0) throw new Error('退勤予定の時刻が不正です。');
  }
  const workMode = shift ? shift.workMode
    : (WORK_MODES.indexOf(payload.workMode) >= 0 ? payload.workMode : MODE_OFFICE);
  const note = String(payload.note || '');

  const existing = readAll_(SHEET_PLAN);
  const saved = [];
  dates.forEach(function (date) {
    let hit = null;
    for (let i = 0; i < existing.length; i++) {
      if (String(existing[i]['社員ID']) === targetId && normDate_(existing[i]['日付']) === date) {
        hit = existing[i];
        break;
      }
    }
    const body = {
      '日付': date,
      '社員ID': targetId,
      '氏名': String(emp['氏名']),
      'シフト': shift ? shift.code : '',
      '出勤予定': start,
      '退勤予定': end,
      '勤務形態': workMode,
      '区分': kind,
      'メモ': note,
      '登録者': auth.employee.name,
      '更新日時': new Date()
    };
    if (hit) {
      updateRow_(SHEET_PLAN, hit._row, body);
      body['予定ID'] = String(hit['予定ID']);
    } else {
      body['予定ID'] = uid_('P');
      appendRow_(SHEET_PLAN, body);
    }
    syncRecordWithPlan_(targetId, date);
    saved.push(date);
  });

  notifyPlanChange_(emp, saved, start, end, kind, workMode, auth.employee.name, false);
  return { saved: saved.length, dates: saved };
}

function deletePlan_(auth, payload) {
  const rows = readAll_(SHEET_PLAN);
  const hit = rows.filter(function (r) { return String(r['予定ID']) === String(payload.planId); })[0];
  if (!hit) throw new Error('その予定は見つかりません。');
  if (!auth.employee.isAdmin && String(hit['社員ID']) !== auth.employee.id) {
    throw new Error('他の人の予定は削除できません。');
  }
  const emp = employeeRowById_(hit['社員ID']);
  const date = normDate_(hit['日付']);
  deleteRow_(SHEET_PLAN, hit._row);
  if (emp) {
    notifyPlanChange_(emp, [date], normTime_(hit['出勤予定']), normTime_(hit['退勤予定']),
      String(hit['区分'] || ''), String(hit['勤務形態'] || ''), auth.employee.name, true);
  }
  return { deleted: 1 };
}

function listPlans_(auth, payload) {
  const range = resolveRange_(payload);
  const scope = resolveScope_(auth, payload.employeeId);
  return readAll_(SHEET_PLAN)
    .filter(function (r) {
      const d = normDate_(r['日付']);
      return d >= range.from && d <= range.to && scope(String(r['社員ID']));
    })
    .map(planToJson_)
    .sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; });
}

function listRecords_(auth, payload) {
  const range = resolveRange_(payload);
  const scope = resolveScope_(auth, payload.employeeId);
  return readAll_(SHEET_RECORD)
    .filter(function (r) {
      const d = normDate_(r['日付']);
      return d >= range.from && d <= range.to && scope(String(r['社員ID']));
    })
    .map(recordToJson_)
    .sort(function (a, b) { return a.date < b.date ? 1 : a.date > b.date ? -1 : 0; });
}

/** 自分以外を触れるのは管理者だけ */
function resolveTargetEmployee_(auth, employeeId) {
  const id = String(employeeId || auth.employee.id);
  if (id !== auth.employee.id && !auth.employee.isAdmin) {
    throw new Error('他の人の情報は操作できません。');
  }
  return id;
}

function resolveScope_(auth, employeeId) {
  if (employeeId === 'all') {
    if (!auth.employee.isAdmin) return function (id) { return id === auth.employee.id; };
    return function () { return true; };
  }
  const id = resolveTargetEmployee_(auth, employeeId);
  return function (x) { return x === id; };
}

function resolveRange_(payload) {
  if (payload && payload.month) return monthRange_(payload.month);
  const from = normDate_((payload && payload.from) || today_());
  const to = normDate_((payload && payload.to) || from);
  return { from: from, to: to };
}

/* ---------- 打刻 ---------- */

/**
 * 出勤・退勤の打刻。
 * payload = {
 *   type: 'in' | 'out',
 *   workMode: '出社' | 'リモート' | '外出・直行直帰',
 *   geo: { lat, lng, accuracy },
 *   device: { id, name, platform, ua },
 *   note: ''
 * }
 */
function punch_(auth, payload) {
  const cfg = getConfig_();
  const type = String(payload.type || '');
  if (type !== 'in' && type !== 'out') throw new Error('打刻の種類が不正です。');

  const emp = auth.row;
  const employeeId = auth.employee.id;
  const date = today_();
  const nowDate = new Date();
  const timeStr = fmtTime_(nowDate);

  const plan = findPlan_(employeeId, date);
  const workMode = WORK_MODES.indexOf(payload.workMode) >= 0
    ? payload.workMode
    : (plan ? String(plan['勤務形態'] || MODE_OFFICE) : MODE_OFFICE);

  // 出社を選んだら位置情報は必須。リモートは任意（取れたら残す）
  const geo = payload.geo || {};
  const hasGeo = typeof geo.lat === 'number' && typeof geo.lng === 'number';
  if (workMode === MODE_OFFICE && !hasGeo) {
    throw new Error('「出社」で打刻するには位置情報が必要です。ブラウザの位置情報を許可してください。');
  }

  let place = '';
  let distance = '';
  if (hasGeo) {
    place = reverseGeocode_(geo.lat, geo.lng);
    const oLat = cfg['事業所緯度'] === '' ? null : Number(cfg['事業所緯度']);
    const oLng = cfg['事業所経度'] === '' ? null : Number(cfg['事業所経度']);
    if (oLat !== null && oLng !== null && !isNaN(oLat) && !isNaN(oLng)) {
      distance = distanceMeters_(geo.lat, geo.lng, oLat, oLng);
    }
  }

  const device = payload.device || {};
  if (device.id) touchDevice_(auth, device);

  let rec = findRecord_(employeeId, date);
  if (!rec) {
    createRecord_(emp, date, plan);
    rec = findRecord_(employeeId, date);
  }

  if (type === 'in' && normTime_(rec['出勤実績'])) {
    throw new Error('本日はすでに ' + normTime_(rec['出勤実績']) + ' に出勤打刻しています。');
  }
  if (type === 'out') {
    if (!normTime_(rec['出勤実績'])) throw new Error('先に出勤の打刻をしてください。');
    if (normTime_(rec['退勤実績'])) {
      throw new Error('本日はすでに ' + normTime_(rec['退勤実績']) + ' に退勤打刻しています。');
    }
  }

  const body = {
    '勤務形態': workMode,
    '端末名': String(device.name || rec['端末名'] || ''),
    '端末ID': String(device.id || rec['端末ID'] || ''),
    '更新日時': nowDate
  };
  if (payload.note) {
    body['備考'] = [String(rec['備考'] || ''), String(payload.note)].filter(String).join(' / ');
  }

  if (type === 'in') {
    body['出勤実績'] = timeStr;
    body['ステータス'] = ST_WORKING;
    body['出勤場所'] = place;
    body['出勤緯度'] = hasGeo ? geo.lat : '';
    body['出勤経度'] = hasGeo ? geo.lng : '';
    body['出勤精度(m)'] = hasGeo && geo.accuracy ? Math.round(geo.accuracy) : '';
    body['出勤事業所距離(m)'] = distance;
  } else {
    body['退勤実績'] = timeStr;
    body['ステータス'] = ST_DONE;
    body['退勤場所'] = place;
    body['退勤緯度'] = hasGeo ? geo.lat : '';
    body['退勤経度'] = hasGeo ? geo.lng : '';
    body['退勤精度(m)'] = hasGeo && geo.accuracy ? Math.round(geo.accuracy) : '';
    body['退勤事業所距離(m)'] = distance;
  }

  updateRow_(SHEET_RECORD, rec._row, body);
  recalcRecord_(employeeId, date, cfg, emp);

  const after = findRecord_(employeeId, date);
  const json = recordToJson_(after);
  notifyPunch_(emp, json, type, cfg);
  return { record: json, status: json.status };
}

/** 予定を元に、その日の記録行を作る */
function createRecord_(emp, date, plan) {
  appendRow_(SHEET_RECORD, {
    '記録ID': uid_('R'),
    '日付': date,
    '社員ID': String(emp['社員ID']),
    '氏名': String(emp['氏名']),
    'シフト': plan ? String(plan['シフト'] || '') : '',
    '出勤予定': plan ? normTime_(plan['出勤予定']) : '',
    '退勤予定': plan ? normTime_(plan['退勤予定']) : '',
    'ステータス': ST_NONE,
    '判定': '',
    '勤務形態': plan ? String(plan['勤務形態'] || '') : '',
    '更新日時': new Date()
  });
}

/** 予定を直したら、まだ打刻していない記録の予定欄も追随させる */
function syncRecordWithPlan_(employeeId, date) {
  const plan = findPlan_(employeeId, date);
  const rec = findRecord_(employeeId, date);
  if (!plan) return;
  if (!rec) {
    const emp = employeeRowById_(employeeId);
    if (emp) createRecord_(emp, date, plan);
    return;
  }
  updateRow_(SHEET_RECORD, rec._row, {
    'シフト': String(plan['シフト'] || ''),
    '出勤予定': normTime_(plan['出勤予定']),
    '退勤予定': normTime_(plan['退勤予定']),
    '更新日時': new Date()
  });
  recalcRecord_(employeeId, date);
}

/** 遅刻・早退・実働・残業・判定を計算し直す */
function recalcRecord_(employeeId, date, cfg, emp) {
  cfg = cfg || getConfig_();
  emp = emp || employeeRowById_(employeeId);
  const rec = findRecord_(employeeId, date);
  if (!rec) return;

  const planIn = timeToMin_(rec['出勤予定']);
  const planOut = timeToMin_(rec['退勤予定']);
  const actIn = timeToMin_(rec['出勤実績']);
  const actOut = timeToMin_(rec['退勤実績']);
  const grace = configNum_(cfg, '遅刻猶予(分)', 5);

  let late = 0;
  let early = 0;
  if (planIn !== null && actIn !== null) late = Math.max(0, actIn - planIn - grace);
  if (planOut !== null && actOut !== null) early = Math.max(0, planOut - actOut);

  let gross = 0;
  let breakMin = 0;
  let work = 0;
  if (actIn !== null && actOut !== null) {
    gross = actOut - actIn;
    if (gross < 0) gross += 24 * 60;   // 日をまたいだ場合
    const shift = findShift_(rec['シフト']);
    const baseBreak = (shift && shift.breakMin) ||
      Number(emp && emp['所定休憩(分)'] ? emp['所定休憩(分)'] : 0) ||
      configNum_(cfg, '自動休憩(分)', 60);
    const threshold = configNum_(cfg, '自動休憩の基準(時間)', 6) * 60;
    breakMin = gross > threshold ? baseBreak : 0;
    work = Math.max(0, gross - breakMin);
  }

  let over = 0;
  if (work > 0 && planIn !== null && planOut !== null) {
    let planWork = planOut - planIn;
    if (planWork < 0) planWork += 24 * 60;
    over = Math.max(0, work - Math.max(0, planWork - breakMin));
  }

  const status = String(rec['ステータス'] || ST_NONE);
  let judge = '';
  if (status === ST_OFF) {
    judge = '休暇';
  } else if (actIn === null && actOut === null) {
    judge = status === ST_ABSENT ? '欠勤' : '';
  } else if (planIn === null && planOut === null) {
    judge = '予定外出勤';
  } else if (actOut === null) {
    judge = late > 0 ? '遅刻' : '予定どおり出勤';
  } else {
    const marks = [];
    if (late > 0) marks.push('遅刻');
    if (early > 0) marks.push('早退');
    judge = marks.length ? marks.join('・') : '予定どおり';
  }

  updateRow_(SHEET_RECORD, rec._row, {
    '遅刻(分)': late,
    '早退(分)': early,
    '休憩(分)': breakMin,
    '実働(分)': work,
    '残業(分)': over,
    '判定': judge,
    '更新日時': new Date()
  });
}

/* ---------- 端末 ---------- */

function registerDevice_(auth, payload) {
  const device = payload.device || payload;
  if (!device.id) throw new Error('端末IDがありません。');
  touchDevice_(auth, device);
  return { device: { id: String(device.id), name: String(device.name || '') } };
}

/** 端末シートに登録／最終利用日時を更新する */
function touchDevice_(auth, device) {
  const rows = readAll_(SHEET_DEVICE);
  const now = new Date();
  for (let i = 0; i < rows.length; i++) {
    if (String(rows[i]['端末ID']) === String(device.id)) {
      updateRow_(SHEET_DEVICE, rows[i]._row, {
        '社員ID': auth.employee.id,
        '氏名': auth.employee.name,
        '端末名': String(device.name || rows[i]['端末名'] || ''),
        'プラットフォーム': String(device.platform || rows[i]['プラットフォーム'] || ''),
        'UA': String(device.ua || rows[i]['UA'] || ''),
        '最終利用': now
      });
      return;
    }
  }
  appendRow_(SHEET_DEVICE, {
    '端末ID': String(device.id),
    '社員ID': auth.employee.id,
    '氏名': auth.employee.name,
    '端末名': String(device.name || ''),
    'プラットフォーム': String(device.platform || ''),
    'UA': String(device.ua || ''),
    '初回登録': now,
    '最終利用': now
  });
}

/* ============================================================
   06_Admin.gs
   ============================================================ */

/**
 * 管理者向け ─ 社員の入退社、PIN、設定、端末一覧
 *
 * 社員は増える前提。アプリの管理画面から追加でき、
 * 辞めた人は行を消さずに「在籍」を外して退社日を入れる（過去の記録が残るため）。
 */

function listEmployees_(auth) {
  return readAll_(SHEET_EMPLOYEE).map(function (r) {
    const e = publicEmployee_(r);
    e.pin = String(r['PIN'] || '');
    e.joinedAt = normDate_(r['入社日']);
    e.retiredAt = normDate_(r['退社日']);
    e.note = String(r['メモ'] || '');
    return e;
  });
}

/**
 * 社員の追加・編集。
 * payload.id が空なら新規。社員IDは E001, E002 … と自動で振る。
 */
function saveEmployee_(auth, payload) {
  const name = String(payload.name || '').trim();
  if (!name) throw new Error('氏名を入力してください。');

  const pin = String(payload.pin || '').trim();
  if (pin && !/^\d{4,8}$/.test(pin)) throw new Error('PINは4〜8桁の数字で入力してください。');

  const email = String(payload.email || '').trim();
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    throw new Error('メールアドレスの形式が正しくありません。');
  }

  const body = {
    '氏名': name,
    'カナ': String(payload.kana || ''),
    'メールアドレス': email,
    '権限': payload.role === ROLE_ADMIN ? ROLE_ADMIN : ROLE_MEMBER,
    '標準出勤': normTime_(payload.defaultStart || '09:00'),
    '標準退勤': normTime_(payload.defaultEnd || '18:00'),
    '所定休憩(分)': Number(payload.breakMin || 0),
    '在籍': payload.active === false ? false : true,
    '入社日': normDate_(payload.joinedAt || ''),
    '退社日': normDate_(payload.retiredAt || ''),
    'メモ': String(payload.note || ''),
    '更新日時': new Date()
  };

  const rows = readAll_(SHEET_EMPLOYEE);
  if (payload.id) {
    const hit = rows.filter(function (r) { return String(r['社員ID']) === String(payload.id); })[0];
    if (!hit) throw new Error('社員が見つかりません。');
    if (pin) body['PIN'] = pin;
    // 最後の管理者を一般に落とさない
    if (body['権限'] !== ROLE_ADMIN && String(hit['権限']) === ROLE_ADMIN && countAdmins_(rows) <= 1) {
      throw new Error('管理者が0人になってしまいます。先に他の人を管理者にしてください。');
    }
    updateRow_(SHEET_EMPLOYEE, hit._row, body);
    return { id: String(payload.id), created: false, pin: pin || String(hit['PIN'] || '') };
  }

  const id = nextEmployeeId_(rows);
  const newPin = pin || String(Math.floor(1000 + Math.random() * 9000));
  body['社員ID'] = id;
  body['PIN'] = newPin;
  if (!body['入社日']) body['入社日'] = today_();
  appendRow_(SHEET_EMPLOYEE, body);
  notifySimple_('社員を追加しました', name + ' さんを登録しました（社員ID: ' + id + '）', '社員追加');
  return { id: id, created: true, pin: newPin };
}

function countAdmins_(rows) {
  return rows.filter(function (r) {
    return String(r['権限']) === ROLE_ADMIN && isActive_(r['在籍']);
  }).length;
}

function nextEmployeeId_(rows) {
  let max = 0;
  rows.forEach(function (r) {
    const m = String(r['社員ID']).match(/^E(\d+)$/);
    if (m) max = Math.max(max, Number(m[1]));
  });
  return 'E' + ('000' + (max + 1)).slice(-3);
}

/** 退社処理。記録は消さず、在籍を外して退社日を入れる */
function retireEmployee_(auth, payload) {
  const rows = readAll_(SHEET_EMPLOYEE);
  const hit = rows.filter(function (r) { return String(r['社員ID']) === String(payload.id); })[0];
  if (!hit) throw new Error('社員が見つかりません。');
  if (String(hit['権限']) === ROLE_ADMIN && countAdmins_(rows) <= 1) {
    throw new Error('管理者が0人になってしまいます。先に他の人を管理者にしてください。');
  }
  updateRow_(SHEET_EMPLOYEE, hit._row, {
    '在籍': false,
    '退社日': normDate_(payload.retiredAt || today_()),
    '更新日時': new Date()
  });
  notifySimple_('退社処理を行いました',
    String(hit['氏名']) + ' さんを退社にしました（' + normDate_(payload.retiredAt || today_()) + '）',
    '退社');
  return { id: String(payload.id) };
}

/** 本人が自分のPINを変える */
function changePin_(auth, payload) {
  const current = String(payload.currentPin || '').trim();
  const next = String(payload.newPin || '').trim();
  if (String(auth.row['PIN'] || '') !== current) throw new Error('今のPINが違います。');
  if (!/^\d{4,8}$/.test(next)) throw new Error('新しいPINは4〜8桁の数字で入力してください。');
  updateRow_(SHEET_EMPLOYEE, auth.row._row, { 'PIN': next, '更新日時': new Date() });
  return { ok: true };
}

/* ---------- 設定 ---------- */

function getSettings_(auth) {
  return readAll_(SHEET_CONFIG).map(function (r) {
    return { key: String(r['キー']), value: String(r['値']), desc: String(r['説明'] || '') };
  });
}

function saveSettings_(auth, payload) {
  const items = payload.settings || [];
  const rows = readAll_(SHEET_CONFIG);
  items.forEach(function (item) {
    const hit = rows.filter(function (r) { return String(r['キー']) === String(item.key); })[0];
    if (hit) {
      updateRow_(SHEET_CONFIG, hit._row, { '値': String(item.value) });
    } else {
      appendRow_(SHEET_CONFIG, { 'キー': String(item.key), '値': String(item.value), '説明': '' });
    }
  });
  return { saved: items.length };
}

function listDevices_(auth) {
  return readAll_(SHEET_DEVICE).map(function (r) {
    return {
      id: String(r['端末ID']),
      employeeId: String(r['社員ID']),
      name: String(r['氏名']),
      deviceName: String(r['端末名'] || ''),
      platform: String(r['プラットフォーム'] || ''),
      firstSeen: r['初回登録'] instanceof Date ? fmtStamp_(r['初回登録']) : String(r['初回登録'] || ''),
      lastSeen: r['最終利用'] instanceof Date ? fmtStamp_(r['最終利用']) : String(r['最終利用'] || '')
    };
  });
}

/* ============================================================
   07_Stats.gs
   ============================================================ */

/**
 * 月次の集計
 *
 * 「1か月どう働いたか」を1画面で見るための数字を作る。
 * リモート率、遅刻回数、平均出退勤、総実働、残業まで。
 */

/**
 * payload = { month: 'yyyy-MM', employeeId: '<社員ID>' | 'all' }
 * 一般社員が 'all' を指定しても自分の分しか返さない（resolveScope_ が絞る）。
 */
function stats_(auth, payload) {
  const month = String(payload.month || Utilities.formatDate(new Date(), TZ, 'yyyy-MM'));
  const range = monthRange_(month);
  const scope = resolveScope_(auth, payload.employeeId);
  const todayStr = today_();

  const records = readAll_(SHEET_RECORD).filter(function (r) {
    const d = normDate_(r['日付']);
    return d >= range.from && d <= range.to && scope(String(r['社員ID']));
  });
  const plans = readAll_(SHEET_PLAN).filter(function (r) {
    const d = normDate_(r['日付']);
    return d >= range.from && d <= range.to && scope(String(r['社員ID']));
  });

  const employees = {};
  function bucket_(id, name) {
    if (!employees[id]) {
      employees[id] = {
        employeeId: id,
        name: name,
        planDays: 0,
        holidayDays: 0,
        workedDays: 0,
        doneDays: 0,
        absentDays: 0,
        officeDays: 0,
        remoteDays: 0,
        fieldDays: 0,
        remoteRate: 0,
        onTimeDays: 0,
        onTimeRate: 0,
        lateCount: 0,
        lateMin: 0,
        earlyCount: 0,
        earlyMin: 0,
        workMin: 0,
        overMin: 0,
        avgWorkMin: 0,
        avgIn: '',
        avgOut: '',
        _inMins: [],
        _outMins: []
      };
    }
    return employees[id];
  }

  plans.forEach(function (p) {
    const b = bucket_(String(p['社員ID']), String(p['氏名']));
    const kind = String(p['区分'] || '通常');
    if (kind === '有給' || kind === '公休' || kind === '特別休暇') b.holidayDays++;
    else b.planDays++;
  });

  records.forEach(function (r) {
    const b = bucket_(String(r['社員ID']), String(r['氏名']));
    const inMin = timeToMin_(r['出勤実績']);
    const outMin = timeToMin_(r['退勤実績']);
    const date = normDate_(r['日付']);
    const status = String(r['ステータス'] || ST_NONE);

    if (inMin !== null) {
      b.workedDays++;
      b._inMins.push(inMin);
      const mode = String(r['勤務形態'] || '');
      if (mode === MODE_REMOTE) b.remoteDays++;
      else if (mode === MODE_FIELD) b.fieldDays++;
      else b.officeDays++;
    } else if (status === ST_ABSENT || (date < todayStr && normTime_(r['出勤予定']))) {
      // 締め処理で欠勤が確定した日は当日でも数える
      b.absentDays++;
    }
    if (outMin !== null) {
      b.doneDays++;
      b._outMins.push(outMin);
    }

    const late = Number(r['遅刻(分)'] || 0);
    const early = Number(r['早退(分)'] || 0);
    if (late > 0) { b.lateCount++; b.lateMin += late; }
    if (early > 0) { b.earlyCount++; b.earlyMin += early; }
    if (inMin !== null && late === 0 && early === 0) b.onTimeDays++;
    b.workMin += Number(r['実働(分)'] || 0);
    b.overMin += Number(r['残業(分)'] || 0);
  });

  const summary = Object.keys(employees).map(function (id) {
    const b = employees[id];
    b.remoteRate = b.workedDays ? Math.round(b.remoteDays * 1000 / b.workedDays) / 10 : 0;
    b.onTimeRate = b.workedDays ? Math.round(b.onTimeDays * 1000 / b.workedDays) / 10 : 0;
    b.avgWorkMin = b.doneDays ? Math.round(b.workMin / b.doneDays) : 0;
    b.avgIn = avgTime_(b._inMins);
    b.avgOut = avgTime_(b._outMins);
    b.workLabel = minToLabel_(b.workMin);
    b.avgWorkLabel = minToLabel_(b.avgWorkMin);
    b.overLabel = minToLabel_(b.overMin);
    delete b._inMins;
    delete b._outMins;
    return b;
  }).sort(function (a, b) { return a.employeeId < b.employeeId ? -1 : 1; });

  const totals = summary.reduce(function (acc, b) {
    acc.workedDays += b.workedDays;
    acc.remoteDays += b.remoteDays;
    acc.officeDays += b.officeDays;
    acc.fieldDays += b.fieldDays;
    acc.lateCount += b.lateCount;
    acc.earlyCount += b.earlyCount;
    acc.absentDays += b.absentDays;
    acc.workMin += b.workMin;
    acc.overMin += b.overMin;
    return acc;
  }, {
    workedDays: 0, remoteDays: 0, officeDays: 0, fieldDays: 0,
    lateCount: 0, earlyCount: 0, absentDays: 0, workMin: 0, overMin: 0
  });
  totals.remoteRate = totals.workedDays
    ? Math.round(totals.remoteDays * 1000 / totals.workedDays) / 10 : 0;
  totals.workLabel = minToLabel_(totals.workMin);
  totals.overLabel = minToLabel_(totals.overMin);

  return {
    month: month,
    from: range.from,
    to: range.to,
    summary: summary,
    totals: totals,
    days: records.map(recordToJson_).sort(function (a, b) {
      return a.date < b.date ? -1 : a.date > b.date ? 1 : 0;
    })
  };
}

/** 分の配列 → 平均の 'HH:mm' */
function avgTime_(mins) {
  if (!mins || !mins.length) return '';
  const sum = mins.reduce(function (a, b) { return a + b; }, 0);
  const avg = Math.round(sum / mins.length);
  return ('0' + Math.floor(avg / 60)).slice(-2) + ':' + ('0' + (avg % 60)).slice(-2);
}

/* ============================================================
   08_Notify.gs
   ============================================================ */

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

  dispatch_(emp, title, lines.join('\n'), isIn ? '出勤打刻' : '退勤打刻', cfg);
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
  dispatch_(emp, head + ' ' + String(emp['氏名']), lines.join('\n'), head, cfg);
}

/** 未打刻アラートなど */
function notifyAlert_(emp, title, body) {
  dispatch_(emp, title, body, 'アラート', getConfig_());
}

/** 社員の追加など、特定の個人に紐づかない連絡 */
function notifySimple_(title, body, kind) {
  dispatch_(null, title, body, kind || 'お知らせ', getConfig_());
}

/** 実際に送る。宛先は「本人」と「管理者全員」 */
function dispatch_(emp, subject, body, kind, cfg) {
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
      postWebhook_(hook, body);
      result.push('Webhook OK');
    } catch (err) {
      result.push('Webhook失敗: ' + err);
    }
  }

  logNotify_(kind, emp, body, to.join(','), result.join(' / ') || '送信先なし');
}

/** Slack / Google Chat / Discord に合わせて本文のキーを変える */
function postWebhook_(url, text) {
  const payload = /discord\.com|discordapp\.com/.test(url) ? { content: text } : { text: text };
  UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });
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

/* ============================================================
   09_Triggers.gs
   ============================================================ */

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

/* ============================================================
   10_Shift.gs
   ============================================================ */

/**
 * シフト
 *
 * 「シフト区分」（早番・日勤・遅番・在宅・公休…）を決めておき、
 * 月間シフト表の「人 × 日」のマス目に区分を置いていくと、
 * その中身が勤務予定（出勤予定・退勤予定・勤務形態・区分）に展開される。
 * 打刻の判定も月次集計も、これまでどおり勤務予定を見るだけで動く。
 */

/* ---------- シフト区分 ---------- */

function listShifts_(includeHidden) {
  return readAll_(SHEET_SHIFT)
    .filter(function (r) { return includeHidden || isActive_(r['有効']); })
    .map(function (r) {
      return {
        code: String(r['記号']),
        name: String(r['名称'] || r['記号']),
        start: normTime_(r['開始']),
        end: normTime_(r['終了']),
        breakMin: Number(r['休憩(分)'] || 0),
        workMode: String(r['勤務形態'] || MODE_OFFICE),
        kind: String(r['区分'] || '通常'),
        color: String(r['色'] || '#6b7689'),
        order: Number(r['並び順'] || 999),
        active: isActive_(r['有効'])
      };
    })
    .sort(function (a, b) { return a.order - b.order; });
}

function findShift_(code) {
  if (!code) return null;
  const hit = listShifts_(true).filter(function (s) { return s.code === String(code); });
  return hit.length ? hit[0] : null;
}

/** シフト区分の追加・変更（記号がキー） */
function saveShift_(auth, payload) {
  const code = String(payload.code || '').trim();
  if (!code) throw new Error('記号を入力してください。');
  if (code.length > 4) throw new Error('記号は4文字までにしてください。');

  const kind = PLAN_KINDS.indexOf(payload.kind) >= 0 ? payload.kind : '通常';
  const isHoliday = (kind === '有給' || kind === '公休' || kind === '特別休暇');
  const start = isHoliday ? '' : normTime_(payload.start || '');
  const end = isHoliday ? '' : normTime_(payload.end || '');
  if (!isHoliday && (timeToMin_(start) === null || timeToMin_(end) === null)) {
    throw new Error('開始と終了の時刻を入れてください。');
  }

  const body = {
    '記号': code,
    '名称': String(payload.name || code),
    '開始': start,
    '終了': end,
    '休憩(分)': Number(payload.breakMin || 0),
    '勤務形態': WORK_MODES.indexOf(payload.workMode) >= 0 ? payload.workMode : MODE_OFFICE,
    '区分': kind,
    '色': String(payload.color || '#6b7689'),
    '並び順': Number(payload.order || 99),
    '有効': payload.active === false ? false : true
  };

  const rows = readAll_(SHEET_SHIFT);
  const hit = rows.filter(function (r) { return String(r['記号']) === code; })[0];
  if (hit) {
    updateRow_(SHEET_SHIFT, hit._row, body);
    return { code: code, created: false };
  }
  appendRow_(SHEET_SHIFT, body);
  return { code: code, created: true };
}

/** シフト区分を消す。既に組まれている予定は残る（記号だけ残骸になる） */
function deleteShift_(auth, payload) {
  const rows = readAll_(SHEET_SHIFT);
  const hit = rows.filter(function (r) { return String(r['記号']) === String(payload.code); })[0];
  if (!hit) throw new Error('そのシフト区分は見つかりません。');
  deleteRow_(SHEET_SHIFT, hit._row);
  return { deleted: 1 };
}

/* ---------- 月間シフト表 ---------- */

/**
 * 「人 × 日」の表を組み立てて返す。
 * 一般社員が呼んだときは自分の行だけになる。
 */
function shiftTable_(auth, payload) {
  const month = String(payload.month || Utilities.formatDate(new Date(), TZ, 'yyyy-MM'));
  const range = monthRange_(month);
  const isAll = auth.employee.isAdmin && payload.employeeId !== auth.employee.id;

  const members = readAll_(SHEET_EMPLOYEE)
    .filter(function (r) { return isActive_(r['在籍']); })
    .filter(function (r) { return isAll || String(r['社員ID']) === auth.employee.id; })
    .map(function (r) { return { id: String(r['社員ID']), name: String(r['氏名']) }; });

  const days = [];
  const parts = range.from.split('-');
  for (let d = 1; d <= range.days; d++) {
    const date = parts[0] + '-' + parts[1] + '-' + ('0' + d).slice(-2);
    const dow = new Date(Number(parts[0]), Number(parts[1]) - 1, d).getDay();
    days.push({ date: date, day: d, dow: dow });
  }

  const memberIds = {};
  members.forEach(function (m) { memberIds[m.id] = true; });

  const cells = {};
  readAll_(SHEET_PLAN).forEach(function (p) {
    const date = normDate_(p['日付']);
    const id = String(p['社員ID']);
    if (date < range.from || date > range.to || !memberIds[id]) return;
    cells[id + '|' + date] = {
      shift: String(p['シフト'] || ''),
      start: normTime_(p['出勤予定']),
      end: normTime_(p['退勤予定']),
      kind: String(p['区分'] || '通常'),
      workMode: String(p['勤務形態'] || ''),
      note: String(p['メモ'] || '')
    };
  });

  // 日ごとの出勤人数と、人ごとの合計
  const coverage = days.map(function (d) {
    let count = 0;
    members.forEach(function (m) {
      const c = cells[m.id + '|' + d.date];
      if (c && c.start) count++;
    });
    return { date: d.date, count: count };
  });

  const totals = members.map(function (m) {
    let workDays = 0;
    let offDays = 0;
    let minutes = 0;
    days.forEach(function (d) {
      const c = cells[m.id + '|' + d.date];
      if (!c) return;
      if (!c.start) { offDays++; return; }
      workDays++;
      const s = timeToMin_(c.start);
      const e = timeToMin_(c.end);
      if (s !== null && e !== null) {
        let w = e - s;
        if (w < 0) w += 24 * 60;
        const sh = findShift_(c.shift);
        minutes += Math.max(0, w - (sh ? sh.breakMin : 0));
      }
    });
    return {
      employeeId: m.id,
      name: m.name,
      workDays: workDays,
      offDays: offDays,
      workMin: minutes,
      workLabel: minToLabel_(minutes)
    };
  });

  return {
    month: month,
    from: range.from,
    to: range.to,
    days: days,
    members: members,
    cells: cells,
    coverage: coverage,
    totals: totals,
    shifts: listShifts_(false)
  };
}

/**
 * シフト表のマス目をまとめて保存する。
 * assignments = [{ employeeId, date, shift }] で、shift が空なら予定を消す。
 */
function assignShifts_(auth, payload) {
  const raw = payload.assignments || [];
  if (!raw.length) return { saved: 0, cleared: 0 };
  if (raw.length > 400) throw new Error('一度に保存できるのは400マスまでです。月を分けてお試しください。');

  // 同じマスが二度来たら後から来たほうを採る
  const dedup = {};
  raw.forEach(function (a) { dedup[String(a.employeeId) + '|' + normDate_(a.date)] = a; });
  const list = Object.keys(dedup).map(function (k) { return dedup[k]; });

  const plans = readAll_(SHEET_PLAN);
  const index = {};
  plans.forEach(function (p) {
    index[String(p['社員ID']) + '|' + normDate_(p['日付'])] = p;
  });

  const employees = {};
  let saved = 0;
  let cleared = 0;
  const touched = {};

  list.forEach(function (a) {
    const employeeId = resolveTargetEmployee_(auth, a.employeeId);
    const date = normDate_(a.date);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('日付が不正です: ' + a.date);

    if (!employees[employeeId]) {
      const emp = employeeRowById_(employeeId);
      if (!emp) throw new Error('社員が見つかりません: ' + employeeId);
      employees[employeeId] = emp;
    }
    const emp = employees[employeeId];
    const key = employeeId + '|' + date;
    const existing = index[key];
    const code = String(a.shift || '').trim();

    if (!code) {
      if (existing) {
        deleteRow_(SHEET_PLAN, existing._row);
        // 行を消したので以降の行番号がずれる。作り直しておく
        readAll_(SHEET_PLAN).forEach(function (p) {
          index[String(p['社員ID']) + '|' + normDate_(p['日付'])] = p;
        });
        delete index[key];
        cleared++;
      }
      return;
    }

    const shift = findShift_(code);
    if (!shift) throw new Error('シフト区分が見つかりません: ' + code);

    const body = {
      '日付': date,
      '社員ID': employeeId,
      '氏名': String(emp['氏名']),
      'シフト': shift.code,
      '出勤予定': shift.start,
      '退勤予定': shift.end,
      '勤務形態': shift.workMode,
      '区分': shift.kind,
      '登録者': auth.employee.name,
      '更新日時': new Date()
    };
    if (existing) {
      updateRow_(SHEET_PLAN, existing._row, body);
    } else {
      body['予定ID'] = uid_('P');
      body['メモ'] = '';
      appendRow_(SHEET_PLAN, body);
    }
    syncRecordWithPlan_(employeeId, date);
    saved++;
    if (!touched[employeeId]) touched[employeeId] = [];
    touched[employeeId].push(date);
  });

  notifyShiftChange_(touched, employees, auth.employee.name);
  return { saved: saved, cleared: cleared };
}

/**
 * 先月のシフトを流用する。曜日が揃うように28日前から写す。
 * 既に入っている予定は上書きしない（手で直した分を消さないため）。
 */
function copyShiftPattern_(auth, payload) {
  const month = String(payload.month || '');
  const range = monthRange_(month);
  const isAll = auth.employee.isAdmin && payload.employeeId !== auth.employee.id;

  const members = readAll_(SHEET_EMPLOYEE)
    .filter(function (r) { return isActive_(r['在籍']); })
    .filter(function (r) { return isAll || String(r['社員ID']) === auth.employee.id; });

  const plans = readAll_(SHEET_PLAN);
  const byKey = {};
  plans.forEach(function (p) {
    byKey[String(p['社員ID']) + '|' + normDate_(p['日付'])] = p;
  });

  const assignments = [];
  const parts = range.from.split('-');
  for (let d = 1; d <= range.days; d++) {
    const date = parts[0] + '-' + parts[1] + '-' + ('0' + d).slice(-2);
    const src = fmtDate_(new Date(Number(parts[0]), Number(parts[1]) - 1, d - 28));
    members.forEach(function (m) {
      const id = String(m['社員ID']);
      if (byKey[id + '|' + date]) return;                 // 既に入っている日は触らない
      const from = byKey[id + '|' + src];
      if (!from || !String(from['シフト'])) return;
      assignments.push({ employeeId: id, date: date, shift: String(from['シフト']) });
    });
  }
  if (!assignments.length) return { saved: 0, cleared: 0, copied: 0 };
  const res = assignShifts_(auth, { assignments: assignments });
  res.copied = assignments.length;
  return res;
}

/** シフトを組んだ／変えたことを本人と管理者に知らせる */
function notifyShiftChange_(touched, employees, byName) {
  const cfg = getConfig_();
  if (!configOn_(cfg, '予定変更を通知', true)) return;
  Object.keys(touched).forEach(function (id) {
    const emp = employees[id];
    if (!emp) return;
    const dates = touched[id];
    const body = [
      '【シフトを組みました】' + String(emp['氏名']) + ' さん',
      '対象日: ' + summarizeDates_(dates),
      '操作者: ' + byName,
      'アプリの「予定」タブで確認してください。'
    ].join('\n');
    dispatch_(emp, 'シフト更新 ' + String(emp['氏名']), body, 'シフト更新', cfg);
  });
}
