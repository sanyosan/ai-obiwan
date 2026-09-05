/**
 * gas/ の中身を1ファイルにまとめる。
 *
 * Apps Script のエディタに手で貼るとき、11ファイルを行き来するのは面倒なので
 * 「これ1枚を貼れば終わり」という形を作っておく。
 *
 *   node attendance-app/tools/bundle.js          … 生成する
 *   node attendance-app/tools/bundle.js --check  … 最新かどうかだけ見る（ズレていたら異常終了）
 */
'use strict';
const fs = require('fs');
const path = require('path');

const GAS_DIR = path.join(__dirname, '..', 'gas');
const OUT = path.join(__dirname, '..', 'paste-to-gas.gs');

function build() {
  const files = fs.readdirSync(GAS_DIR).filter(function (f) { return f.endsWith('.gs'); }).sort();
  const head = [
    '/**',
    ' * 未来創造家 勤怠アプリ ─ Apps Script に貼る用の1枚版',
    ' *',
    ' * attendance-app/gas/ の全ファイルをつなげたもの。',
    ' * 直接編集しないこと。直すときは gas/ の中を直して',
    ' *   node attendance-app/tools/bundle.js',
    ' * で作り直す。',
    ' *',
    ' * 収録: ' + files.join(', '),
    ' */',
    ''
  ].join('\n');

  const body = files.map(function (f) {
    const src = fs.readFileSync(path.join(GAS_DIR, f), 'utf8').replace(/\s+$/, '');
    return [
      '/* ============================================================',
      '   ' + f,
      '   ============================================================ */',
      '',
      src,
      ''
    ].join('\n');
  }).join('\n');

  return head + '\n' + body;
}

const content = build();

if (process.argv.indexOf('--check') >= 0) {
  const current = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8') : '';
  if (current !== content) {
    console.error('paste-to-gas.gs が gas/ の中身と一致していません。');
    console.error('node attendance-app/tools/bundle.js で作り直してください。');
    process.exit(1);
  }
  console.log('paste-to-gas.gs は最新です。');
} else {
  fs.writeFileSync(OUT, content);
  const lines = content.split('\n').length;
  console.log('書き出しました: ' + OUT + '（' + lines + '行）');
}
