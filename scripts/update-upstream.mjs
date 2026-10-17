import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, dirname, basename, join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { buildWorker } from './build.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ref = process.argv[2];
if (!/^[0-9a-f]{40}$/i.test(ref || '')) throw new Error('用法: node scripts/update-upstream.mjs <上游完整 commit SHA>');
const localIndex = process.argv.indexOf('--source');
let downloaded;
if (localIndex >= 0) {
    downloaded = await readFile(resolve(process.argv[localIndex + 1]), 'utf8');
} else {
    const response = await fetch('https://raw.githubusercontent.com/cmliu/edgetunnel/' + ref + '/_worker.js', { signal: AbortSignal.timeout(30000) });
    if (!response.ok) throw new Error('上游下载失败: ' + response.status);
    downloaded = await response.text();
}
const core = downloaded.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
const built = await buildWorker(core);
const hash = createHash('sha256').update(core).digest('hex');
const temp = await mkdtemp(join(tmpdir(), 'edgetunnel2-check-'));
try {
    const candidate = join(temp, 'worker.mjs');
    await writeFile(candidate, built);
    for (const args of [['--check', candidate], [resolve(root, 'tests/chain-proxy.test.mjs')]]) {
        const check = spawnSync(process.execPath, args, { cwd: root, stdio: 'inherit', env: { ...process.env, EDGE_WORKER_FILE: candidate, EDGE_UPSTREAM_SHA256: hash } });
        if (check.status !== 0 || check.error) throw new Error('候选版本验证失败，现有 Worker 未修改');
    }
    const metadata = JSON.parse(await readFile(resolve(root, 'upstream.json'), 'utf8'));
    Object.assign(metadata, { ref, core_sha256: hash, version: core.match(/const Version = '([^']+)'/)?.[1] || null });
    await writeFile(resolve(root, '_worker.js'), built);
    await writeFile(resolve(root, 'upstream.json'), JSON.stringify(metadata, null, 2) + '\n');
    console.log('上游更新及链式代理验证通过，请审查 git diff 后提交。');
} finally {
    if (dirname(resolve(temp)) !== resolve(tmpdir()) || !basename(temp).startsWith('edgetunnel2-check-')) throw new Error('临时目录校验失败');
    await rm(temp, { recursive: true, force: true });
}
