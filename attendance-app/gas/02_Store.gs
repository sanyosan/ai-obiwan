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
