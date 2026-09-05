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
