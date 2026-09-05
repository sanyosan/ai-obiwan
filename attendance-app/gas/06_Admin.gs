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
