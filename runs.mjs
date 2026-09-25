import dns from 'node:dns'; import fs from 'node:fs';
dns.setDefaultResultOrder('ipv4first');
const TOKEN = fs.readFileSync('C:/Users/31534/Desktop/qdii-pages/.ghtoken', 'utf8').trim();
const H = { 'Authorization': 'Bearer ' + TOKEN, 'Accept': 'application/vnd.github+json', 'User-Agent': 'qdii-board' };
const r = await fetch('https://api.github.com/repos/a3153423343-crypto/qdii-pages/actions/runs?per_page=5', { headers: H, signal: AbortSignal.timeout(30000) });
const j = await r.json();
for (const w of (j.workflow_runs || [])) console.log('#' + w.run_number + ' ' + w.event.padEnd(13) + ' ' + w.status + '/' + (w.conclusion || '-') + ' | ' + w.created_at + ' | ' + Math.round((w.run_started_at ? (new Date(w.updated_at) - new Date(w.run_started_at)) / 1000 : 0)) + 's');
