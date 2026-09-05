/**
 * 未来創造家 勤怠 ─ フロント（PWA）
 *
 * 画面はこの1ファイルで動く。サーバーは Google Apps Script。
 * 保存しているもの: 接続先URL / アプリキー / ログイントークン / 端末ID・端末名
 */
(function () {
  'use strict';

  var LS = 'kintai.';
  var $ = function (sel) { return document.querySelector(sel); };
  var $$ = function (sel) { return Array.prototype.slice.call(document.querySelectorAll(sel)); };

  var store = {
    get: function (k, d) { var v = localStorage.getItem(LS + k); return v === null ? d : v; },
    set: function (k, v) { localStorage.setItem(LS + k, v); },
    del: function (k) { localStorage.removeItem(LS + k); }
  };

  var state = {
    url: store.get('url', ''),
    key: store.get('key', ''),
    token: store.get('token', ''),
    me: null,
    boot: null,
    mode: store.get('mode', '出社'),
    geo: null,
    calMonth: null,
    selected: {},
    monthPlans: {}
  };

  /* ================= 通信 ================= */

  function jsonp(req) {
    return new Promise(function (resolve, reject) {
      var cb = '__kintai_cb_' + Date.now() + Math.floor(Math.random() * 1000);
      var url = state.url + '?p=' + encodeURIComponent(JSON.stringify(req)) + '&callback=' + cb;
      if (url.length > 7500) { reject(new Error('データが大きすぎます。件数を減らしてお試しください。')); return; }
      var s = document.createElement('script');
      var timer = setTimeout(function () { cleanup(); reject(new Error('通信がタイムアウトしました。')); }, 20000);
      function cleanup() { clearTimeout(timer); delete window[cb]; if (s.parentNode) s.parentNode.removeChild(s); }
      window[cb] = function (data) { cleanup(); resolve(data); };
      s.onerror = function () { cleanup(); reject(new Error('サーバーに接続できませんでした。')); };
      s.src = url;
      document.body.appendChild(s);
    });
  }

  function api(action, payload) {
    var req = { action: action, appKey: state.key, token: state.token, payload: payload || {} };
    return fetch(state.url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(req),
      redirect: 'follow'
    }).then(function (res) { return res.json(); })
      .catch(function () { return jsonp(req); })   // POSTが通らない環境ではJSONPで
      .then(function (data) {
        if (!data) throw new Error('サーバーから応答がありません。');
        if (!data.ok) {
          if (/ログイン/.test(data.error || '')) forceLogout();
          throw new Error(data.error || '不明なエラー');
        }
        return data;
      });
  }

  /* ================= 小道具 ================= */

  function toast(text) {
    var el = $('#toast');
    el.textContent = text;
    el.hidden = false;
    clearTimeout(el._t);
    el._t = setTimeout(function () { el.hidden = true; }, 2600);
  }

  function msg(sel, text, kind) {
    var el = $(sel);
    el.textContent = text || '';
    el.className = 'msg' + (kind ? ' ' + kind : '');
  }

  function pad(n) { return ('0' + n).slice(-2); }
  function ymd(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function ym(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1); }
  var DOW = ['日', '月', '火', '水', '木', '金', '土'];
  function dowOf(dateStr) {
    var p = dateStr.split('-');
    return DOW[new Date(+p[0], +p[1] - 1, +p[2]).getDay()];
  }
  function mdLabel(dateStr) {
    var p = dateStr.split('-');
    return (+p[1]) + '/' + (+p[2]) + '（' + dowOf(dateStr) + '）';
  }
  function minLabel(min) {
    var n = Math.max(0, Math.round(min || 0));
    var h = Math.floor(n / 60);
    return (h ? h + '時間' : '') + (n % 60) + '分';
  }
  function esc(s) {
    return String(s === null || s === undefined ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  /* ================= 端末 ================= */

  function deviceInfo() {
    var id = store.get('deviceId', '');
    if (!id) {
      id = (window.crypto && crypto.randomUUID)
        ? crypto.randomUUID()
        : 'dev-' + Date.now() + '-' + Math.floor(Math.random() * 1e6);
      store.set('deviceId', id);
    }
    return {
      id: id,
      name: store.get('deviceName', ''),
      platform: guessPlatform(),
      ua: navigator.userAgent
    };
  }

  function guessPlatform() {
    var ua = navigator.userAgent;
    if (/iPhone/.test(ua)) return 'iPhone';
    if (/iPad/.test(ua)) return 'iPad';
    if (/Android/.test(ua)) return 'Android';
    if (/Macintosh/.test(ua)) return 'Mac';
    if (/Windows/.test(ua)) return 'Windows';
    return 'その他';
  }

  /* ================= 位置情報 ================= */

  function getPosition() {
    return new Promise(function (resolve, reject) {
      if (!navigator.geolocation) { reject(new Error('この端末では位置情報が使えません。')); return; }
      navigator.geolocation.getCurrentPosition(
        function (pos) {
          resolve({
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
            accuracy: pos.coords.accuracy
          });
        },
        function (err) {
          var m = {
            1: '位置情報が許可されていません。端末の設定から許可してください。',
            2: '位置情報を取得できませんでした。屋外や窓際でお試しください。',
            3: '位置情報の取得に時間がかかっています。もう一度お試しください。'
          };
          reject(new Error(m[err.code] || '位置情報を取得できませんでした。'));
        },
        { enableHighAccuracy: true, timeout: 12000, maximumAge: 30000 }
      );
    });
  }

  function renderGeo(text, kind) {
    var el = $('#geo-state');
    el.textContent = text;
    el.className = 'geo' + (kind ? ' ' + kind : '');
  }

  function refreshGeo() {
    if (state.mode === 'リモート') { renderGeo('リモート：位置情報は任意です'); return Promise.resolve(null); }
    renderGeo('位置情報を取得中…');
    return getPosition().then(function (g) {
      state.geo = g;
      var line = '位置情報：取得ずみ（誤差 約' + Math.round(g.accuracy) + 'm）';
      var o = state.boot && state.boot.office;
      if (o && o.lat !== null && o.lat !== undefined && !isNaN(o.lat)) {
        var d = distance(g.lat, g.lng, o.lat, o.lng);
        line += ' / ' + (o.name || '事業所') + 'から約' + (d >= 1000 ? (Math.round(d / 100) / 10) + 'km' : d + 'm');
        renderGeo(line, d <= (o.radius || 300) ? 'ok' : '');
      } else {
        renderGeo(line, 'ok');
      }
      return g;
    }).catch(function (e) {
      state.geo = null;
      renderGeo('位置情報：' + e.message, 'ng');
      return null;
    });
  }

  function distance(lat1, lng1, lat2, lng2) {
    var R = 6371000, r = Math.PI / 180;
    var dLat = (lat2 - lat1) * r, dLng = (lng2 - lng1) * r;
    var a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
    return Math.round(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
  }

  /* ================= 起動 ================= */

  function show(id) {
    ['#scr-config', '#scr-login', '#app'].forEach(function (s) { $(s).hidden = (s !== id); });
  }

  function init() {
    var q = new URLSearchParams(location.search);
    if (q.get('api')) { state.url = q.get('api'); store.set('url', state.url); }
    if (q.get('key')) { state.key = q.get('key'); store.set('key', state.key); }
    if (q.get('api') || q.get('key')) history.replaceState({}, '', location.pathname);

    bindAll();
    startClock();
    registerSW();

    if (!state.url) { show('#scr-config'); return; }
    if (!state.token) { openLogin(); return; }
    loadApp();
  }

  function openLogin() {
    show('#scr-login');
    msg('#login-msg', '読み込み中…');
    api('members').then(function (d) {
      var sel = $('#login-member');
      sel.innerHTML = d.members.map(function (m) {
        return '<option value="' + esc(m.id) + '">' + esc(m.name) + '</option>';
      }).join('');
      var last = store.get('lastMember', '');
      if (last) sel.value = last;
      msg('#login-msg', '');
    }).catch(function (e) { msg('#login-msg', e.message, 'err'); });
  }

  function loadApp() {
    return api('bootstrap').then(function (d) {
      state.boot = d;
      state.me = d.employee;
      show('#app');
      $('#me-name').textContent = d.employee.name;
      $('#me-role').textContent = d.employee.isAdmin ? '管理者' : '';
      $('#me-role').hidden = !d.employee.isAdmin;
      $('#app-version').textContent = 'バージョン ' + d.version + ' / 社員ID ' + d.employee.id;
      $('#admin-block').hidden = !d.employee.isAdmin;

      setupModePicker(d.workModes);
      fillSelect($('#plan-kind'), d.planKinds, '通常');
      fillSelect($('#plan-mode'), d.workModes, '出社');
      setupMemberSelectors();
      registerDevice();

      renderHome();
      var now = new Date();
      $('#log-month').value = ym(now);
      $('#stats-month').value = ym(now);
      state.calMonth = new Date(now.getFullYear(), now.getMonth(), 1);
      $('#plan-start').value = d.employee.defaultStart;
      $('#plan-end').value = d.employee.defaultEnd;
      renderCalendar();
      renderPlanList();
      refreshGeo();
    }).catch(function (e) {
      if (/ログイン/.test(e.message)) return;
      show('#scr-login');
      msg('#login-msg', e.message, 'err');
    });
  }

  function forceLogout() {
    store.del('token');
    state.token = '';
    show('#scr-login');
    openLogin();
  }

  function registerDevice() {
    var dev = deviceInfo();
    var auto = state.me.name + 'の' + dev.platform;
    // 自動で付けた名前のままなら、使う人が変わったときに付け直す
    if (!dev.name || (store.get('deviceNameAuto', '') === '1' && dev.name !== auto)) {
      dev.name = auto;
      store.set('deviceName', dev.name);
      store.set('deviceNameAuto', '1');
    }
    $('#dev-name').value = dev.name;
    $('#dev-id').textContent = '端末ID: ' + dev.id;
    api('registerDevice', { device: dev }).catch(function () { /* 失敗しても打刻はできる */ });
  }

  function fillSelect(sel, items, current) {
    sel.innerHTML = items.map(function (v) {
      return '<option' + (v === current ? ' selected' : '') + '>' + esc(v) + '</option>';
    }).join('');
  }

  function setupMemberSelectors() {
    if (!state.me.isAdmin) return;
    var members = state.boot.members || [];
    var opts = members.map(function (m) {
      return '<option value="' + esc(m.id) + '">' + esc(m.name) + '</option>';
    }).join('');
    var planSel = $('#plan-employee');
    planSel.innerHTML = opts;
    planSel.value = state.me.id;
    planSel.hidden = false;

    ['#log-employee', '#stats-employee'].forEach(function (s) {
      var el = $(s);
      el.innerHTML = '<option value="all">全員</option>' + opts;
      el.value = state.me.id;
      el.hidden = false;
    });
  }

  function setupModePicker(modes) {
    var box = $('#mode-picker');
    box.innerHTML = modes.map(function (m) {
      return '<button type="button" data-mode="' + esc(m) + '"' +
        (m === state.mode ? ' class="on"' : '') + '>' + esc(m) + '</button>';
    }).join('');
    box.onclick = function (ev) {
      var b = ev.target.closest('button');
      if (!b) return;
      state.mode = b.dataset.mode;
      store.set('mode', state.mode);
      $$('#mode-picker button').forEach(function (x) { x.classList.toggle('on', x === b); });
      refreshGeo();
    };
  }

  /* ================= ホーム ================= */

  function startClock() {
    function tick() {
      var d = new Date();
      var t = $('#clock-time');
      if (t) t.textContent = pad(d.getHours()) + ':' + pad(d.getMinutes());
      var dd = $('#clock-date');
      if (dd) dd.textContent = d.getFullYear() + '年' + (d.getMonth() + 1) + '月' + d.getDate() + '日（' + DOW[d.getDay()] + '）';
    }
    tick();
    setInterval(tick, 10000);
  }

  function renderHome() {
    var t = state.boot.today;
    var plan = t.plan;
    $('#today-plan').innerHTML = plan
      ? (plan.kind !== '通常'
        ? '<span class="badge">' + esc(plan.kind) + '</span>'
        : '<span class="big">' + esc(plan.start) + ' 〜 ' + esc(plan.end) + '</span> ' +
          '<span class="badge' + (plan.workMode === 'リモート' ? ' remote' : '') + '">' + esc(plan.workMode) + '</span>' +
          (plan.note ? '<div class="sub">' + esc(plan.note) + '</div>' : ''))
      : '<span class="empty">今日の予定は登録されていません</span>';

    var st = t.status || '未出勤';
    var badge = $('#me-status');
    badge.textContent = st;
    badge.className = 'status' + (st === '出勤中' ? ' working' : st === '退勤済' ? ' done' : '');

    $('#btn-in').disabled = (st !== '未出勤' && st !== '欠勤');
    $('#btn-out').disabled = (st !== '出勤中');

    var r = t.record;
    if (!r || (!r.inTime && !r.outTime)) {
      $('#today-record').innerHTML = '<span class="empty">まだ打刻がありません</span>';
      return;
    }
    var rows = [];
    rows.push(['出勤', r.inTime || '—' + (r.planStart ? '（予定 ' + r.planStart + '）' : '')]);
    rows.push(['退勤', r.outTime || '未打刻']);
    if (r.workMode) rows.push(['勤務形態', r.workMode]);
    if (r.judge) rows.push(['判定', r.judge]);
    if (r.workMin) rows.push(['実働', minLabel(r.workMin) + (r.overMin ? '（残業 ' + minLabel(r.overMin) + '）' : '')]);
    if (r.inPlace) rows.push(['出勤場所', r.inPlace + (r.inDistance !== null ? '（約' + r.inDistance + 'm）' : '')]);
    if (r.outPlace) rows.push(['退勤場所', r.outPlace]);
    $('#today-record').innerHTML = '<dl>' + rows.map(function (kv) {
      return '<dt>' + esc(kv[0]) + '</dt><dd>' + esc(kv[1]) + '</dd>';
    }).join('') + '</dl>';
  }

  function punch(type) {
    var btn = type === 'in' ? $('#btn-in') : $('#btn-out');
    btn.disabled = true;
    msg('#punch-msg', '打刻しています…');

    var need = state.mode !== 'リモート';
    var geoP = need ? getPosition().catch(function (e) {
      if (state.mode === '出社') throw e;
      return null;
    }) : getPosition().catch(function () { return null; });

    geoP.then(function (geo) {
      state.geo = geo;
      return api('punch', {
        type: type,
        workMode: state.mode,
        geo: geo,
        device: deviceInfo()
      });
    }).then(function (d) {
      state.boot.today.record = d.record;
      state.boot.today.status = d.status;
      renderHome();
      msg('#punch-msg', (type === 'in' ? '出勤' : '退勤') + 'を記録しました。', 'ok');
      toast((type === 'in' ? '出勤' : '退勤') + ' ' + (type === 'in' ? d.record.inTime : d.record.outTime));
      if (navigator.vibrate) navigator.vibrate(30);
    }).catch(function (e) {
      msg('#punch-msg', e.message, 'err');
      renderHome();
    });
  }

  /* ================= 予定 ================= */

  function planTargetId() {
    return state.me.isAdmin && $('#plan-employee').value ? $('#plan-employee').value : state.me.id;
  }

  function renderCalendar() {
    var base = state.calMonth;
    var y = base.getFullYear(), m = base.getMonth();
    $('#cal-title').textContent = y + '年' + (m + 1) + '月';

    var first = new Date(y, m, 1);
    var start = new Date(y, m, 1 - first.getDay());
    var todayStr = ymd(new Date());
    var html = '';
    for (var i = 0; i < 42; i++) {
      var d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
      var s = ymd(d);
      var cls = [];
      if (d.getMonth() !== m) cls.push('other');
      if (s === todayStr) cls.push('today');
      if (state.selected[s]) cls.push('on');
      if (state.monthPlans[s]) cls.push('has');
      html += '<button type="button" data-date="' + s + '" class="' + cls.join(' ') + '">' + d.getDate() + '</button>';
    }
    $('#cal-grid').innerHTML = html;

    loadMonthPlans(ym(base));
  }

  function loadMonthPlans(month) {
    api('listPlans', { month: month, employeeId: planTargetId() }).then(function (d) {
      state.monthPlans = {};
      d.plans.forEach(function (p) { state.monthPlans[p.date] = p; });
      $$('#cal-grid button').forEach(function (b) {
        b.classList.toggle('has', !!state.monthPlans[b.dataset.date]);
      });
    }).catch(function () { /* カレンダーの点は無くても困らない */ });
  }

  function renderPlanList() {
    var from = ymd(new Date());
    var to = ymd(new Date(Date.now() + 60 * 864e5));
    api('listPlans', { from: from, to: to, employeeId: planTargetId() }).then(function (d) {
      var box = $('#plan-list');
      if (!d.plans.length) { box.innerHTML = '<span class="empty">これからの予定はありません</span>'; return; }
      box.innerHTML = d.plans.map(function (p) {
        var time = p.kind !== '通常' ? p.kind : p.start + '〜' + p.end;
        return '<div class="item">' +
          '<div class="main"><div class="times">' + esc(mdLabel(p.date)) + '　' + esc(time) + '</div>' +
          '<div class="sub">' + esc(p.workMode) + (p.note ? ' / ' + esc(p.note) : '') + '</div></div>' +
          '<button class="btn ghost sm" data-del="' + esc(p.id) + '">削除</button></div>';
      }).join('');
      box.onclick = function (ev) {
        var b = ev.target.closest('[data-del]');
        if (!b) return;
        if (!confirm('この予定を削除しますか？')) return;
        api('deletePlan', { planId: b.dataset.del }).then(function () {
          toast('削除しました');
          renderPlanList();
          renderCalendar();
          if (state.boot) loadApp();
        }).catch(function (e) { toast(e.message); });
      };
    }).catch(function (e) { $('#plan-list').innerHTML = '<span class="empty">' + esc(e.message) + '</span>'; });
  }

  function savePlan() {
    var dates = Object.keys(state.selected).filter(function (k) { return state.selected[k]; }).sort();
    if (!dates.length) { msg('#plan-msg', 'カレンダーで日付を選んでください。', 'err'); return; }
    msg('#plan-msg', '登録しています…');
    api('savePlan', {
      dates: dates,
      start: $('#plan-start').value,
      end: $('#plan-end').value,
      workMode: $('#plan-mode').value,
      kind: $('#plan-kind').value,
      note: $('#plan-note').value,
      employeeId: planTargetId()
    }).then(function (d) {
      msg('#plan-msg', d.saved + '日分の予定を登録しました。', 'ok');
      toast(d.saved + '日分を登録');
      state.selected = {};
      $('#plan-note').value = '';
      renderCalendar();
      renderPlanList();
      loadApp();
    }).catch(function (e) { msg('#plan-msg', e.message, 'err'); });
  }

  /* ================= 履歴 ================= */

  function renderLog() {
    var box = $('#log-list');
    box.innerHTML = '<span class="empty">読み込み中…</span>';
    api('listRecords', {
      month: $('#log-month').value,
      employeeId: state.me.isAdmin ? $('#log-employee').value : state.me.id
    }).then(function (d) {
      if (!d.records.length) { box.innerHTML = '<span class="empty">記録がありません</span>'; return; }
      box.innerHTML = d.records.map(function (r) {
        var badge = judgeBadge(r.judge, r.status);
        var who = (state.me.isAdmin && $('#log-employee').value === 'all') ? esc(r.name) + '　' : '';
        return '<div class="item">' +
          '<div class="main">' +
          '<div class="times">' + who + esc(mdLabel(r.date)) + '　' +
          esc(r.inTime || '--:--') + '〜' + esc(r.outTime || '--:--') + '</div>' +
          '<div class="sub">予定 ' + esc(r.planStart || '--:--') + '〜' + esc(r.planEnd || '--:--') +
          '　' + esc(r.workMode || '-') +
          (r.workMin ? '　実働' + minLabel(r.workMin) : '') +
          (r.inPlace ? '<br>' + esc(r.inPlace) : '') +
          '</div></div>' + badge + '</div>';
      }).join('');
    }).catch(function (e) { box.innerHTML = '<span class="empty">' + esc(e.message) + '</span>'; });
  }

  function judgeBadge(judge, status) {
    var cls = 'badge';
    if (/予定どおり/.test(judge)) cls += ' ok';
    else if (/遅刻|早退/.test(judge)) cls += ' late';
    else if (/欠勤|打刻なし/.test(judge)) cls += ' bad';
    return '<span class="' + cls + '">' + esc(judge || status || '-') + '</span>';
  }

  /* ================= 統計 ================= */

  function renderStats() {
    var box = $('#stats-kpi');
    box.innerHTML = '<span class="empty">読み込み中…</span>';
    var who = state.me.isAdmin ? $('#stats-employee').value : state.me.id;
    api('stats', { month: $('#stats-month').value, employeeId: who }).then(function (d) {
      var t = d.totals;
      var kpis = [
        ['出勤日数', t.workedDays + '日'],
        ['総実働', t.workLabel || '0分'],
        ['残業', t.overLabel || '0分'],
        ['遅刻', t.lateCount + '回'],
        ['早退', t.earlyCount + '回'],
        ['欠勤', t.absentDays + '日']
      ];
      box.innerHTML = kpis.map(function (k) {
        return '<div class="kpi"><b>' + esc(k[1]) + '</b><span>' + esc(k[0]) + '</span></div>';
      }).join('');

      var total = t.officeDays + t.remoteDays + t.fieldDays;
      var pct = function (n) { return total ? (n * 100 / total) : 0; };
      $('#stats-remote').innerHTML = total ? (
        '<div class="bar">' +
        '<div class="bar-label"><span>働き方の内訳</span><strong>リモート率 ' + t.remoteRate + '%</strong></div>' +
        '<div class="bar-track">' +
        '<i style="width:' + pct(t.officeDays) + '%;background:#12a06a"></i>' +
        '<i style="width:' + pct(t.remoteDays) + '%;background:#2f6fed"></i>' +
        '<i style="width:' + pct(t.fieldDays) + '%;background:#d4a017"></i>' +
        '</div>' +
        '<div class="bar-legend">' +
        '<em><span class="dot" style="background:#12a06a"></span>出社 ' + t.officeDays + '日</em>' +
        '<em><span class="dot" style="background:#2f6fed"></span>リモート ' + t.remoteDays + '日</em>' +
        '<em><span class="dot" style="background:#d4a017"></span>外出 ' + t.fieldDays + '日</em>' +
        '</div></div>'
      ) : '';

      var showTable = state.me.isAdmin && who === 'all' && d.summary.length > 1;
      $('#stats-table-card').hidden = !showTable;
      if (showTable) {
        $('#stats-table').innerHTML =
          '<table><thead><tr><th>氏名</th><th>出勤</th><th>実働</th><th>残業</th>' +
          '<th>遅刻</th><th>早退</th><th>欠勤</th><th>リモート率</th><th>平均出勤</th><th>平均退勤</th></tr></thead><tbody>' +
          d.summary.map(function (s) {
            return '<tr><td>' + esc(s.name) + '</td><td>' + s.workedDays + '</td><td>' + esc(s.workLabel || '-') +
              '</td><td>' + esc(s.overLabel || '-') + '</td><td>' + s.lateCount + '</td><td>' + s.earlyCount +
              '</td><td>' + s.absentDays + '</td><td>' + s.remoteRate + '%</td><td>' + esc(s.avgIn || '-') +
              '</td><td>' + esc(s.avgOut || '-') + '</td></tr>';
          }).join('') + '</tbody></table>';
      }
    }).catch(function (e) { box.innerHTML = '<span class="empty">' + esc(e.message) + '</span>'; });
  }

  /* ================= 管理 ================= */

  function renderAdmin() {
    if (!state.me.isAdmin) return;

    api('listEmployees').then(function (d) {
      $('#emp-list').innerHTML = d.employees.map(function (e) {
        return '<div class="item">' +
          '<div class="main"><div>' + esc(e.name) +
          (e.role === '管理者' ? ' <span class="badge">管理者</span>' : '') +
          (e.active ? '' : ' <span class="badge bad">退社</span>') + '</div>' +
          '<div class="sub">' + esc(e.id) + '　' + esc(e.email || 'メール未設定') +
          '　' + esc(e.defaultStart) + '〜' + esc(e.defaultEnd) + '　PIN ' + esc(e.pin) + '</div></div>' +
          '<button class="btn ghost sm" data-emp="' + esc(e.id) + '">編集</button></div>';
      }).join('');
      $('#emp-list').onclick = function (ev) {
        var b = ev.target.closest('[data-emp]');
        if (!b) return;
        var emp = d.employees.filter(function (x) { return x.id === b.dataset.emp; })[0];
        openEmpDialog(emp);
      };
    }).catch(function (e) { $('#emp-list').innerHTML = '<span class="empty">' + esc(e.message) + '</span>'; });

    api('getSettings').then(function (d) {
      $('#settings-list').innerHTML = d.settings.map(function (s) {
        return '<label class="field"><span>' + esc(s.key) +
          (s.desc ? '　<small>' + esc(s.desc) + '</small>' : '') + '</span>' +
          '<input data-key="' + esc(s.key) + '" type="text" value="' + esc(s.value) + '"></label>';
      }).join('');
    }).catch(function (e) { $('#settings-list').innerHTML = '<span class="empty">' + esc(e.message) + '</span>'; });

    api('listDevices').then(function (d) {
      $('#device-list').innerHTML = d.devices.length ? d.devices.map(function (v) {
        return '<div class="item"><div class="main"><div>' + esc(v.deviceName || v.platform) + '</div>' +
          '<div class="sub">' + esc(v.name) + '　' + esc(v.platform) + '　最終利用 ' + esc(v.lastSeen) + '</div></div></div>';
      }).join('') : '<span class="empty">まだ登録がありません</span>';
    }).catch(function () { });
  }

  function openEmpDialog(emp) {
    var dlg = $('#emp-dialog');
    $('#emp-dialog-title').textContent = emp ? '社員を編集' : '社員を追加';
    $('#emp-id').value = emp ? emp.id : '';
    $('#emp-name').value = emp ? emp.name : '';
    $('#emp-kana').value = emp ? emp.kana : '';
    $('#emp-email').value = emp ? emp.email : '';
    $('#emp-role').value = emp ? emp.role : '一般';
    $('#emp-pin').value = '';
    $('#emp-start').value = emp ? emp.defaultStart : '09:00';
    $('#emp-end').value = emp ? emp.defaultEnd : '18:00';
    $('#emp-break').value = emp ? emp.breakMin : 60;
    $('#emp-joined').value = emp ? (emp.joinedAt || '') : '';
    $('#emp-active').checked = emp ? emp.active : true;
    msg('#emp-msg', emp ? '' : 'PINを空にすると4桁の数字が自動で発行されます。');
    dlg.showModal();
  }

  function saveEmployee(ev) {
    ev.preventDefault();
    var payload = {
      id: $('#emp-id').value || '',
      name: $('#emp-name').value,
      kana: $('#emp-kana').value,
      email: $('#emp-email').value,
      role: $('#emp-role').value,
      pin: $('#emp-pin').value,
      defaultStart: $('#emp-start').value,
      defaultEnd: $('#emp-end').value,
      breakMin: $('#emp-break').value,
      joinedAt: $('#emp-joined').value,
      active: $('#emp-active').checked
    };
    if (!payload.name) { msg('#emp-msg', '氏名を入力してください。', 'err'); return; }
    msg('#emp-msg', '保存しています…');
    api('saveEmployee', payload).then(function (d) {
      $('#emp-dialog').close();
      toast(d.created ? '追加しました（PIN: ' + d.pin + '）' : '保存しました');
      renderAdmin();
      loadApp();
    }).catch(function (e) { msg('#emp-msg', e.message, 'err'); });
  }

  /* ================= タブ ================= */

  function openTab(name) {
    $$('.tab').forEach(function (b) { b.classList.toggle('active', b.dataset.tab === name); });
    ['home', 'plan', 'log', 'stats', 'more'].forEach(function (n) {
      $('#tab-' + n).hidden = (n !== name);
    });
    window.scrollTo(0, 0);
    if (name === 'log') renderLog();
    if (name === 'stats') renderStats();
    if (name === 'more') renderAdmin();
    if (name === 'home') refreshGeo();
    if (name === 'plan') { renderCalendar(); renderPlanList(); }
  }

  /* ================= イベント ================= */

  function bindAll() {
    $('#cfg-save').onclick = function () {
      var url = $('#cfg-url').value.trim();
      var key = $('#cfg-key').value.trim();
      if (!/^https?:\/\/\S+$/.test(url)) {
        msg('#cfg-msg', 'URLは https://script.google.com/… /exec の形で入れてください。', 'err');
        return;
      }
      state.url = url; state.key = key;
      store.set('url', url); store.set('key', key);
      msg('#cfg-msg', '接続を確認しています…');
      api('ping').then(function () { openLogin(); })
        .catch(function (e) { msg('#cfg-msg', e.message, 'err'); });
    };

    $('#login-go').onclick = function () {
      var id = $('#login-member').value;
      var pin = $('#login-pin').value;
      if (!id) { msg('#login-msg', '名前を選んでください。', 'err'); return; }
      msg('#login-msg', 'ログインしています…');
      api('login', { employeeId: id, pin: pin }).then(function (d) {
        state.token = d.token;
        store.set('token', d.token);
        store.set('lastMember', id);
        $('#login-pin').value = '';
        msg('#login-msg', '');
        loadApp();
      }).catch(function (e) { msg('#login-msg', e.message, 'err'); });
    };
    $('#login-pin').addEventListener('keydown', function (e) {
      if (e.key === 'Enter') $('#login-go').click();
    });
    $('#login-reset').onclick = function () {
      store.del('url'); store.del('key'); store.del('token');
      state.url = ''; state.key = ''; state.token = '';
      show('#scr-config');
    };

    $('#btn-in').onclick = function () { punch('in'); };
    $('#btn-out').onclick = function () { punch('out'); };

    $$('.tab').forEach(function (b) { b.onclick = function () { openTab(b.dataset.tab); }; });

    $('#cal-prev').onclick = function () {
      state.calMonth = new Date(state.calMonth.getFullYear(), state.calMonth.getMonth() - 1, 1);
      renderCalendar();
    };
    $('#cal-next').onclick = function () {
      state.calMonth = new Date(state.calMonth.getFullYear(), state.calMonth.getMonth() + 1, 1);
      renderCalendar();
    };
    $('#cal-grid').onclick = function (ev) {
      var b = ev.target.closest('button');
      if (!b) return;
      var d = b.dataset.date;
      state.selected[d] = !state.selected[d];
      b.classList.toggle('on', state.selected[d]);
    };
    $('#cal-weekdays').onclick = function () {
      var y = state.calMonth.getFullYear(), m = state.calMonth.getMonth();
      var last = new Date(y, m + 1, 0).getDate();
      for (var i = 1; i <= last; i++) {
        var d = new Date(y, m, i);
        if (d.getDay() !== 0 && d.getDay() !== 6) state.selected[ymd(d)] = true;
      }
      renderCalendar();
    };
    $('#cal-clear').onclick = function () { state.selected = {}; renderCalendar(); };
    $('#plan-save').onclick = savePlan;
    $('#plan-employee').onchange = function () { renderCalendar(); renderPlanList(); };
    $('#plan-kind').onchange = function () {
      var holiday = ['有給', '公休', '特別休暇'].indexOf($('#plan-kind').value) >= 0;
      $('#plan-start').disabled = holiday;
      $('#plan-end').disabled = holiday;
    };

    $('#log-month').onchange = renderLog;
    $('#log-employee').onchange = renderLog;
    $('#stats-month').onchange = renderStats;
    $('#stats-employee').onchange = renderStats;

    $('#dev-save').onclick = function () {
      var name = $('#dev-name').value.trim();
      if (!name) { toast('端末名を入れてください'); return; }
      store.set('deviceName', name);
      store.set('deviceNameAuto', '0');   // 手で付けた名前は上書きしない
      api('registerDevice', { device: deviceInfo() })
        .then(function () { toast('保存しました'); })
        .catch(function (e) { toast(e.message); });
    };

    $('#pin-save').onclick = function () {
      msg('#pin-msg', '変更しています…');
      api('changePin', { currentPin: $('#pin-cur').value, newPin: $('#pin-new').value })
        .then(function () {
          msg('#pin-msg', 'PINを変更しました。', 'ok');
          $('#pin-cur').value = ''; $('#pin-new').value = '';
        })
        .catch(function (e) { msg('#pin-msg', e.message, 'err'); });
    };

    $('#emp-new').onclick = function () { openEmpDialog(null); };
    $('#emp-save').onclick = saveEmployee;

    $('#settings-save').onclick = function () {
      var items = $$('#settings-list input[data-key]').map(function (i) {
        return { key: i.dataset.key, value: i.value };
      });
      msg('#settings-msg', '保存しています…');
      api('saveSettings', { settings: items })
        .then(function () { msg('#settings-msg', '保存しました。', 'ok'); loadApp(); })
        .catch(function (e) { msg('#settings-msg', e.message, 'err'); });
    };

    $('#btn-logout').onclick = function () {
      if (!confirm('ログアウトしますか？')) return;
      api('logout').catch(function () { }).then(function () {
        store.del('token');
        state.token = '';
        openLogin();
      });
    };

    document.addEventListener('visibilitychange', function () {
      if (!document.hidden && state.token && state.boot) loadApp();
    });
  }

  /* ================= Service Worker ================= */

  function registerSW() {
    if (!('serviceWorker' in navigator)) return;
    navigator.serviceWorker.register('sw.js').catch(function () { /* file:// などでは無視 */ });
  }

  document.addEventListener('DOMContentLoaded', init);
})();
