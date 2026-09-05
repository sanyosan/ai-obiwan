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

  const kind = PLAN_KINDS.indexOf(payload.kind) >= 0 ? payload.kind : '通常';
  const isHoliday = (kind === '有給' || kind === '公休' || kind === '特別休暇');
  const start = isHoliday ? '' : normTime_(payload.start || emp['標準出勤']);
  const end = isHoliday ? '' : normTime_(payload.end || emp['標準退勤']);
  if (!isHoliday) {
    if (!timeToMin_(start) && timeToMin_(start) !== 0) throw new Error('出勤予定の時刻が不正です。');
    if (!timeToMin_(end) && timeToMin_(end) !== 0) throw new Error('退勤予定の時刻が不正です。');
  }
  const workMode = WORK_MODES.indexOf(payload.workMode) >= 0 ? payload.workMode : MODE_OFFICE;
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
    const baseBreak = Number(emp && emp['所定休憩(分)'] ? emp['所定休憩(分)'] : 0) ||
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
