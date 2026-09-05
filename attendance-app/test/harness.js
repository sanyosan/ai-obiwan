/**
 * GAS の主要サービスをメモリ上で模擬して、勤怠アプリのサーバー側を実際に動かす。
 * 目的は「打刻から集計まで通しで動くか」を確かめること。
 */
'use strict';
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const GAS_DIR = path.join(__dirname, '..', 'gas');

/* ---------- 時刻の固定 ---------- */
let CURRENT = new Date('2026-09-04T23:58:00Z'); // JST 2026-09-05 08:58
function setNow(iso) { CURRENT = new Date(iso); }
class MockDate extends Date {
  constructor(...a) { if (a.length === 0) super(CURRENT.getTime()); else super(...a); }
  static now() { return CURRENT.getTime(); }
}

const pad = n => ('0' + n).slice(-2);
function formatDate(date, tz, pattern) {
  const t = new Date(date.getTime() + 9 * 3600 * 1000);
  const map = {
    yyyy: t.getUTCFullYear(), MM: pad(t.getUTCMonth() + 1), dd: pad(t.getUTCDate()),
    HH: pad(t.getUTCHours()), mm: pad(t.getUTCMinutes()), ss: pad(t.getUTCSeconds())
  };
  return pattern.replace(/yyyy|MM|dd|HH|mm|ss/g, m => map[m]);
}

/* ---------- スプレッドシート ---------- */
class Range {
  constructor(sheet, r, c, nr, nc) { Object.assign(this, { sheet, r, c, nr, nc }); }
  getValues() {
    const out = [];
    for (let i = 0; i < this.nr; i++) {
      const row = [];
      for (let j = 0; j < this.nc; j++) row.push(this.sheet._get(this.r + i, this.c + j));
      out.push(row);
    }
    return out;
  }
  setValues(vals) {
    vals.forEach((row, i) => row.forEach((v, j) => this.sheet._set(this.r + i, this.c + j, v)));
    return this;
  }
  setValue(v) { this.sheet._set(this.r, this.c, v); return this; }
  setFontWeight() { return this; }
  setBackground() { return this; }
  setFontColor() { return this; }
}

class Sheet {
  constructor(name) { this.name = name; this.rows = []; this.maxCols = 26; }
  getName() { return this.name; }
  _cell(r) { if (!this.rows[r - 1]) this.rows[r - 1] = []; return this.rows[r - 1]; }
  _get(r, c) { const v = this._cell(r)[c - 1]; return v === undefined ? '' : v; }
  _set(r, c, v) { this._cell(r)[c - 1] = v; if (c > this.maxCols) this.maxCols = c; }
  getLastRow() {
    let last = 0;
    this.rows.forEach((row, i) => {
      if (row && row.some(v => v !== '' && v !== undefined && v !== null)) last = i + 1;
    });
    return last;
  }
  getLastColumn() {
    let last = 0;
    this.rows.forEach(row => {
      if (!row) return;
      for (let j = row.length - 1; j >= 0; j--) {
        if (row[j] !== '' && row[j] !== undefined && row[j] !== null) { last = Math.max(last, j + 1); break; }
      }
    });
    return last;
  }
  getMaxColumns() { return this.maxCols; }
  deleteColumns(start, count) { this.maxCols = start - 1; this.rows.forEach(r => r && r.splice(start - 1, count)); }
  getRange(r, c, nr = 1, nc = 1) { return new Range(this, r, c, nr, nc); }
  appendRow(arr) { const r = this.getLastRow() + 1; arr.forEach((v, j) => this._set(r, j + 1, v)); }
  deleteRow(r) { this.rows.splice(r - 1, 1); }
  setFrozenRows() { return this; }
  setColumnWidth() { return this; }
}

class Spreadsheet {
  constructor(name) { this.name = name; this.sheets = []; this.id = 'ss-' + Math.random().toString(36).slice(2); }
  getId() { return this.id; }
  getUrl() { return 'https://docs.google.com/spreadsheets/d/' + this.id; }
  getSheets() { return this.sheets.slice(); }
  getSheetByName(n) { return this.sheets.find(s => s.name === n) || null; }
  insertSheet(n) { const s = new Sheet(n); this.sheets.push(s); return s; }
  deleteSheet(s) { this.sheets = this.sheets.filter(x => x !== s); }
  setSpreadsheetTimeZone() { }
}

const SPREADSHEETS = {};
const SpreadsheetApp = {
  create(name) { const ss = new Spreadsheet(name); SPREADSHEETS[ss.getId()] = ss; return ss; },
  openById(id) { if (!SPREADSHEETS[id]) throw new Error('not found'); return SPREADSHEETS[id]; },
  getActiveSpreadsheet() { return null; }
};

/* ---------- その他のサービス ---------- */
const propsStore = {};
const PropertiesService = {
  getScriptProperties: () => ({
    getProperty: k => (k in propsStore ? propsStore[k] : null),
    setProperty: (k, v) => { propsStore[k] = String(v); },
    deleteProperty: k => { delete propsStore[k]; },
    getProperties: () => Object.assign({}, propsStore)
  })
};

const cacheStore = {};
const CacheService = {
  getScriptCache: () => ({
    get: k => (k in cacheStore ? cacheStore[k] : null),
    put: (k, v) => { cacheStore[k] = String(v); },
    remove: k => { delete cacheStore[k]; }
  })
};

const LockService = { getScriptLock: () => ({ tryLock: () => true, releaseLock: () => { } }) };

const sentMail = [];
const MailApp = { sendEmail: o => sentMail.push(o) };

const sentHooks = [];
const UrlFetchApp = { fetch: (url, o) => { sentHooks.push({ url, o }); return { getResponseCode: () => 200 }; } };

const Maps = {
  newGeocoder: () => ({
    setLanguage() { return this; },
    reverseGeocode: (lat, lng) => ({
      results: [{ formatted_address: '日本、大阪府堺市中区(' + lat.toFixed(3) + ',' + lng.toFixed(3) + ')' }]
    })
  })
};

const logs = [];
const Logger = { log: m => logs.push(String(m)) };

const triggers = [];
const ScriptApp = {
  getProjectTriggers: () => [],
  deleteTrigger: () => { },
  newTrigger(fn) {
    const t = { fn };
    const chain = {
      timeBased: () => chain,
      everyMinutes: () => chain,
      everyDays: () => chain,
      atHour: () => chain,
      nearMinute: () => chain,
      create: () => { triggers.push(t); return t; }
    };
    return chain;
  }
};

const ContentService = {
  MimeType: { JSON: 'JSON', JAVASCRIPT: 'JS' },
  createTextOutput(s) { return { _s: s, setMimeType() { return this; }, getContent() { return this._s; } }; }
};

let uuidSeq = 0;
const Utilities = {
  formatDate,
  getUuid: () => {
    const h = n => Array.from({ length: n }, () => '0123456789abcdef'[Math.floor(Math.random() * 16)]).join('');
    uuidSeq++;
    return h(8) + '-' + h(4) + '-4' + h(3) + '-a' + h(3) + '-' + h(12);
  }
};

/* ---------- 読み込み ---------- */
const sandbox = {
  Date: MockDate, Math, JSON, String, Number, Object, Array, Boolean, RegExp, Error, isNaN, parseInt, parseFloat,
  console, SpreadsheetApp, PropertiesService, CacheService, LockService, MailApp, UrlFetchApp,
  Maps, Logger, ScriptApp, ContentService, Utilities
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);

fs.readdirSync(GAS_DIR).filter(f => f.endsWith('.gs')).sort().forEach(f => {
  vm.runInContext(fs.readFileSync(path.join(GAS_DIR, f), 'utf8'), sandbox, { filename: f });
});

// const 宣言は sandbox のプロパティにならないので、明示的に取り出す
vm.runInContext(`this.C = {
  SHEET_EMPLOYEE, SHEET_PLAN, SHEET_RECORD, SHEET_DEVICE, SHEET_NOTIFY, SHEET_CONFIG,
  ROLE_ADMIN, ROLE_MEMBER, WORK_MODES, APP_VERSION
};`, sandbox);

module.exports = { sandbox, setNow, sentMail, sentHooks, logs, triggers, propsStore };
