/**
 * Tab Harbor — 可复现打包:node tools/pack.js
 *
 * 为什么需要它
 * ------------
 * v3.11.2 的商店包是手工压缩的产物:里面混进了 test/(43KB,占 34%)与一份
 * 内部备忘录 提交说明.md,而项目自己的排除规则本该拦住它们。没有脚本就没有
 * 可复现性,审核者也无法由源码重建同一个包。
 *
 * 设计要点
 * --------
 * 1. **显式白名单**:只打包运行时真正需要的目录/文件。散落在仓库根的新文件
 *    (补丁脚本、备忘录、未来的临时文件)天然进不来 —— 用"排除法"迟早漏一个。
 * 2. **引用完整性检查**:三个页面的 <script src>/<link href> 指向的每个资源
 *    都必须在打包清单里,否则直接构建失败(防止漏文件出包)。
 * 3. **确定性**:zip 内时间戳固定,同一份源码永远产出同一个 SHA-256,
 *    因此 BUILD-INFO.txt 里的哈希可被任何人重新推导验证。
 * 4. **零依赖**:自带最小 ZIP 写入器(zlib deflateRaw),不需要 npm 装包。
 *
 * 用法:
 *   node tools/pack.js                  # 跑测试 → 出 cws + review 两个包
 *   node tools/pack.js --skip-tests     # 跳过测试(仅调试打包本身)
 *   node tools/pack.js --out <dir>      # 指定输出目录(默认仓库上一级)
 */
'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const APP = 'tab-harbor';

/* ---------------- 打包清单(显式白名单) ---------------- */

/** 扩展运行时必须存在的顶层条目 */
const SHIP = [
  'manifest.json',
  'background.js',
  '_locales',
  'icons',
  'manager',
  'popup',
  'sidepanel',
  'shared',
  'styles',
];

/** 审核包额外包含:文档 + 测试 + 工具(让审核者可自行复现全部测试) */
const REVIEW_EXTRA = [
  'README.md', 'ARCHITECTURE.md', 'CHANGELOG.md', '提交说明.md',
  'test', 'tools',
];

/** 永不打包 */
const NEVER = ['.git', 'node_modules', 'dist', '.gitignore', '.gitattributes'];

/* ---------------- 最小 ZIP 写入器(零依赖) ---------------- */

const CRC_TABLE = (function () {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i += 1) c = (c >>> 8) ^ CRC_TABLE[(c ^ buf[i]) & 0xff];
  return (c ^ (-1)) >>> 0;
}

// 固定的 DOS 时间戳 = 1980-01-01 00:00:00,保证同一份源码产出同一份字节
const DOS_TIME = 0;
const DOS_DATE = 0x21;

/** @param {{name:string,data:Buffer}[]} entries 按给定顺序写入 */
function makeZip(entries) {
  const local = [];
  const central = [];
  let offset = 0;
  for (const e of entries) {
    const nameBuf = Buffer.from(e.name, 'utf8');
    const raw = e.data;
    const deflated = zlib.deflateRawSync(raw, { level: 9 });
    const useDeflate = deflated.length < raw.length;
    const body = useDeflate ? deflated : raw;
    const method = useDeflate ? 8 : 0;
    const crc = crc32(raw);

    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0);
    lh.writeUInt16LE(20, 4);
    lh.writeUInt16LE(0x0800, 6);      // UTF-8 文件名
    lh.writeUInt16LE(method, 8);
    lh.writeUInt16LE(DOS_TIME, 10);
    lh.writeUInt16LE(DOS_DATE, 12);
    lh.writeUInt32LE(crc, 14);
    lh.writeUInt32LE(body.length, 18);
    lh.writeUInt32LE(raw.length, 22);
    lh.writeUInt16LE(nameBuf.length, 26);
    lh.writeUInt16LE(0, 28);
    local.push(lh, nameBuf, body);

    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(20, 4);
    cd.writeUInt16LE(20, 6);
    cd.writeUInt16LE(0x0800, 8);
    cd.writeUInt16LE(method, 10);
    cd.writeUInt16LE(DOS_TIME, 12);
    cd.writeUInt16LE(DOS_DATE, 14);
    cd.writeUInt32LE(crc, 16);
    cd.writeUInt32LE(body.length, 20);
    cd.writeUInt32LE(raw.length, 24);
    cd.writeUInt16LE(nameBuf.length, 28);
    cd.writeUInt16LE(0, 30);
    cd.writeUInt16LE(0, 32);
    cd.writeUInt16LE(0, 34);
    cd.writeUInt16LE(0, 36);
    cd.writeUInt32LE(0, 38);
    cd.writeUInt32LE(offset, 42);
    central.push(cd, nameBuf);

    offset += lh.length + nameBuf.length + body.length;
  }
  const cdBuf = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cdBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);
  return Buffer.concat([Buffer.concat(local), cdBuf, eocd]);
}

/* ---------------- 文件收集 ---------------- */

function walkInto(absDir, relDir, acc) {
  for (const name of fs.readdirSync(absDir).sort()) {
    if (NEVER.indexOf(name) >= 0) continue;
    const abs = path.join(absDir, name);
    const rel = relDir ? relDir + '/' + name : name;
    const st = fs.statSync(abs);
    if (st.isDirectory()) walkInto(abs, rel, acc);
    else acc.push(rel);
  }
  return acc;
}

function collect(topLevel) {
  const files = [];
  for (const entry of topLevel) {
    const abs = path.join(ROOT, entry);
    if (!fs.existsSync(abs)) throw new Error('打包清单里的条目不存在: ' + entry);
    if (fs.statSync(abs).isDirectory()) walkInto(abs, entry, files);
    else files.push(entry);
  }
  return files.sort();
}

/* ---------------- 引用完整性:页面引用的资源都必须在包里 ---------------- */

function checkAssetRefs(shipFiles) {
  const inShip = new Set(shipFiles);
  const problems = [];
  for (const f of shipFiles) {
    if (!/\.html$/.test(f)) continue;
    const html = fs.readFileSync(path.join(ROOT, f), 'utf8');
    const re = /(?:src|href)\s*=\s*"([^"]+)"/g;
    let m;
    while ((m = re.exec(html))) {
      const ref = m[1];
      if (/^(https?:|data:|mailto:|#|chrome-extension:)/.test(ref)) continue;
      const clean = ref.split('?')[0].split('#')[0];
      if (!clean) continue;
      const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(f), clean));
      if (!inShip.has(resolved)) problems.push(f + ' 引用 ' + ref + ' → ' + resolved + ' 不在包里');
    }
  }
  return problems;
}

/* ---------------- BUILD-INFO ---------------- */

function gitInfo() {
  try {
    const rev = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim();
    const dirty = execFileSync('git', ['status', '--porcelain'], { cwd: ROOT, encoding: 'utf8' }).trim();
    return { rev, dirty: !!dirty };
  } catch (e) {
    return { rev: '', dirty: false };
  }
}

/* ---------------- 主流程 ---------------- */

function main() {
  const argv = process.argv.slice(2);
  const skipTests = argv.indexOf('--skip-tests') >= 0;
  const outIdx = argv.indexOf('--out');
  const outDir = outIdx >= 0 ? path.resolve(argv[outIdx + 1]) : path.join(ROOT, '..');

  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
  const version = manifest.version;
  const tag = APP + '-v' + version;

  /* 1. 发布门禁 */
  let testReport = '(\u672a\u8fd0\u884c\u6d4b\u8bd5)\n';
  if (!skipTests) {
    const { runAll } = require('./test-all.js');
    const r = runAll({ quiet: true });
    testReport = r.report;
    if (!r.ok) {
      process.stderr.write(r.report + '\n打包中止:存在失败的测试。\n');
      process.exit(1);
    }
    process.stdout.write('门禁通过: ' + r.suites.length + ' 套全部 PASS\n');
  } else {
    process.stdout.write('已跳过测试(--skip-tests)\n');
  }

  /* 2. 收集运行时文件 + 引用完整性 */
  const shipFiles = collect(SHIP);
  if (shipFiles.indexOf('manifest.json') < 0) throw new Error('manifest.json 必须在 zip 根目录');
  const problems = checkAssetRefs(shipFiles);
  if (problems.length) {
    process.stderr.write('引用完整性失败:\n  ' + problems.join('\n  ') + '\n');
    process.exit(1);
  }

  /* 3. 先出商店包(不能含 test/、tools/、任何 .md) */
  const cwsEntries = shipFiles.map((f) => ({ name: f, data: fs.readFileSync(path.join(ROOT, f)) }));
  const cwsBuf = makeZip(cwsEntries);
  const cwsSha = crypto.createHash('sha256').update(cwsBuf).digest('hex');

  const leaked = cwsEntries.filter((e) => /^(test|tools)\//.test(e.name) || /\.md$/.test(e.name));
  if (leaked.length) throw new Error('商店包混入了非运行时文件: ' + leaked.map((e) => e.name).join(', '));

  /* 4. 审核包 = 完整源码 + 文档 + 测试 + 工具 + 本次构建信息 */
  const git = gitInfo();
  const buildInfo = [
    'Tab Harbor v' + version + ' — BUILD INFO',
    'Version: ' + version,
    'Build date: ' + new Date().toISOString(),
    'CWS zip SHA-256: ' + cwsSha,
    'CWS zip entries: ' + cwsEntries.length,
    'Node: ' + process.version,
    'Git: ' + (git.rev ? git.rev + (git.dirty ? ' (worktree dirty)' : '') : '(不可用)'),
    'Manifest: MV3, minimum_chrome_version ' + manifest.minimum_chrome_version
      + ', default_locale ' + manifest.default_locale,
    '',
    '打包可复现:node tools/pack.js。zip 内时间戳固定,源码不变则 SHA-256 不变。',
  ].join('\n') + '\n';

  const reviewTop = SHIP.concat(REVIEW_EXTRA);
  const reviewFiles = collect(reviewTop);
  const reviewEntries = reviewFiles.map((f) => ({ name: f, data: fs.readFileSync(path.join(ROOT, f)) }));
  reviewEntries.push({ name: 'BUILD-INFO.txt', data: Buffer.from(buildInfo, 'utf8') });
  reviewEntries.push({ name: 'TEST-REPORT.txt', data: Buffer.from(testReport, 'utf8') });
  // 把商店包本体也放进来:审核者可对照 BUILD-INFO 里的 SHA-256 当场核验
  reviewEntries.push({ name: tag + '-cws.zip', data: cwsBuf });
  reviewEntries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  const reviewBuf = makeZip(reviewEntries);

  /* 5. 落盘 */
  fs.mkdirSync(outDir, { recursive: true });
  const cwsPath = path.join(outDir, tag + '-cws.zip');
  const reviewPath = path.join(outDir, tag + '-review.zip');
  fs.writeFileSync(cwsPath, cwsBuf);
  fs.writeFileSync(reviewPath, reviewBuf);

  process.stdout.write('\n商店包 ' + path.basename(cwsPath) + '  ' + cwsEntries.length + ' 项  '
    + (cwsBuf.length / 1024).toFixed(1) + ' KB\n  SHA-256 ' + cwsSha + '\n');
  process.stdout.write('审核包 ' + path.basename(reviewPath) + '  ' + reviewEntries.length + ' 项  '
    + (reviewBuf.length / 1024).toFixed(1) + ' KB\n');
  process.stdout.write(JSON.stringify({ cws: cwsPath, review: reviewPath, sha256: cwsSha }, null, 2) + '\n');
}

if (require.main === module) main();
module.exports = { makeZip, collect, checkAssetRefs, SHIP, REVIEW_EXTRA };
