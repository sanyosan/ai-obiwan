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
  const days = configNum_(getConfig_(), 'ログイン有効日数', TOKEN_DAYS);
  const exp = Date.now() + days * 24 * 60 * 60 * 1000;
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
