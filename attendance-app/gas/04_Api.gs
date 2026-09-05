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
