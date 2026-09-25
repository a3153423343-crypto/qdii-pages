import fs from 'node:fs';
import path from 'node:path';
import dns from 'node:dns';
import { fileURLToPath } from 'node:url';
dns.setDefaultResultOrder('ipv4first');

const DIR = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(DIR, 'public');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/143.0 Safari/537.36';
const REF = { 'Referer': 'https://fundf10.eastmoney.com/' };
const LIMIT_RE = /限额|限制金额|大额申购|暂停申购|恢复申购|调整.{0,4}申购/;
const HOLIDAY_RE = /节假日|境外主要投资市场|停牌|维护|风险提示|季度报告|中期报告|年度报告|招募说明书|资料概要|旗下部分基金|提示性公告/;

async function get(url, hdr) {
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch(url, { headers: Object.assign({ 'User-Agent': UA }, hdr || {}), signal: AbortSignal.timeout(20000) });
      const t = await r.text();
      if (t && t.length > 20) return t;
    } catch (e) {}
    await new Promise(s => setTimeout(s, 400));
  }
  return '';
}
async function jj(url, hdr) { try { return JSON.parse(await get(url, hdr)); } catch (e) { return {}; } }

async function fetchStatus(codes) {
  const out = {};
  const q = codes.slice();
  await Promise.all(Array.from({ length: 6 }, async () => {
    while (q.length) {
      const c = q.shift();
      const o = await jj('https://fundmobapi.eastmoney.com/FundMNewApi/FundMNNBasicInformation?FCODE=' + c + '&deviceid=1&plat=Android&product=EFund&version=6.2.8');
      const d = o.Datas || {};
      if (d.SGZT) out[c] = { sgzt: d.SGZT, minsg: d.MINSG || '', maxsg: d.MAXSG || '', dwjz: d.DWJZ || '', rzdf: d.RZDF || '' };
    }
  }));
  return out;
}

async function fetchAnnIndex(codes) {
  const out = {};
  const q = [...new Set(codes)];
  await Promise.all(Array.from({ length: 6 }, async () => {
    while (q.length) {
      const c = q.shift();
      const o = await jj('https://api.fund.eastmoney.com/f10/JJGG?fundcode=' + c + '&pageIndex=1&pageSize=20&type=0', REF);
      const L = (o && o.Data) || [];
      const cand = L.filter(x => LIMIT_RE.test(x.TITLE || '') && !HOLIDAY_RE.test(x.TITLE || ''));
      out[c] = cand[0] ? { id: cand[0].ID, date: String(cand[0].PUBLISHDATEDesc || '').slice(0, 10), title: cand[0].TITLE } : null;
    }
  }));
  return out;
}

const app = JSON.parse(fs.readFileSync(path.join(DIR, 'qdii-limits-app.json'), 'utf8'));
const notes = [];
let st = {}, an = {};
try { st = await fetchStatus(app.codes); } catch (e) { notes.push('状态抓取异常: ' + e.message); }
try { an = await fetchAnnIndex(app.groups.flatMap(g => g.rows.map(r => r.codeArr[0]))); } catch (e) { notes.push('公告抓取异常: ' + e.message); }
if (!Object.keys(st).length) notes.push('申购状态接口无返回，沿用公告基准值');
if (!Object.keys(an).length) notes.push('公告索引接口无返回');

const groups = app.groups.map(g => ({
  name: g.name,
  rows: g.rows.map(r => {
    const c = r.codeArr[0];
    const s = st[c] || {};
    const a = an[c];
    const isEtf = g.name.indexOf('ETF') >= 0 && g.name.indexOf('场内') >= 0;
    const changed = !!(a && a.date && a.date > (app.verifiedAt || '2999-01-01'));
    const maxsg = (s.maxsg && Number(s.maxsg) <= 1000000) ? s.maxsg : '';
    return Object.assign({}, r, {
      isEtf: isEtf,
      live: isEtf ? {} : { sgzt: s.sgzt || '', minsg: s.minsg || '', maxsg: maxsg, dwjz: s.dwjz || '', rzdf: s.rzdf || '' },
      liveOk: r.status === '仅直销开放' && s.sgzt === '暂停申购',
      newAnn: changed ? a : null
    });
  })
}));

let dated = 0, susp = 0, onlyDirect = 0, alerts = 0;
for (const g of groups) for (const r of g.rows) {
  if (r.status === '暂停申购' || r.status === '暂停申赎') susp++;
  else if (r.status === '仅直销开放') onlyDirect++;
  else if (r.zx && r.zx !== '—') dated++;
  if (r.newAnn) alerts++;
}
const out = {
  ok: true,
  generatedAt: new Date().toISOString(),
  dataDate: app.updatedAt,
  source: app.source,
  liveCodes: Object.keys(st).length,
  lastError: notes.join('；'),
  stats: { total: dated + susp + onlyDirect, quota: dated, suspended: susp, onlyDirect: onlyDirect, alerts: alerts },
  groups
};

fs.mkdirSync(OUT, { recursive: true });
const json = JSON.stringify(out);
fs.writeFileSync(path.join(OUT, 'limits.json'), json);
fs.writeFileSync(path.join(OUT, 'limits-snap.js'), 'window.SNAP=' + json + ';');
console.log('生成完成 ' + new Date().toISOString() + ' | 实时状态 ' + Object.keys(st).length + ' 只 | ' + JSON.stringify(out.stats) + (notes.length ? ' | 备注: ' + notes.join('；') : ''));
