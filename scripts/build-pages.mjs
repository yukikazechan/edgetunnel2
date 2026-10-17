import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const option = (name, fallback) => args.includes(name) ? resolve(args[args.indexOf(name) + 1]) : fallback;
const input = option('--admin', resolve(root, 'admin/index.html'));
const out = option('--out', null);
const ui = await readFile(resolve(root, 'extensions/chain-proxy-ui.js'), 'utf8');
let html = (await readFile(input, 'utf8')).replace(/<script id="edgetunnel2-chain-ui">[\s\S]*?<\/script>\s*/g, '');
const end = html.toLowerCase().lastIndexOf('</body>');
if (end < 0) throw new Error('管理页面缺少 body 结束标记');
html = html.slice(0, end) + '<script id="edgetunnel2-chain-ui">\n' + ui + '\n</script>\n' + html.slice(end);
const targets = out ? [resolve(out, 'index.html')] : [resolve(root, 'admin/index.html'), resolve(root, 'admin_page.html')];
for (const target of targets) {
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, html);
    console.log('Built ' + target);
}
if (out && args.includes('--login')) {
    await writeFile(resolve(out, 'login.html'), await readFile(option('--login'), 'utf8'));
}
