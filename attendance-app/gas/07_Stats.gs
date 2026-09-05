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
