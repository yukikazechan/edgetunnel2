import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const hooks = [
    ['env', '\tasync fetch(request, env, ctx) {', `\tasync fetch(request, env, ctx) {
        // Legacy installations used the binding name "sub"; KV always takes precedence.
        if (!env.KV && env.sub && typeof env.sub.get === 'function') env = { ...env, KV: env.sub };
        const Pages静态页面 = String(env.PAGES_URL || 'https://edt-pages.github.io').replace(/\\/+$/, '');`],
    ['api', '\t\t\t\t\tconfig_JSON = await 读取config_JSON(env, host, userID, UA);', `                    if (访问路径 === 'admin/chain-proxy.json') return 链式代理.handle(request, env.KV);
\t\t\t\t\tconfig_JSON = await 读取config_JSON(env, host, userID, UA);`],
    ['page', "\t\t\t\t\treturn fetch(Pages静态页面 + '/admin' + url.search);", "                    return 链式代理.adminPage(await fetch(Pages静态页面 + '/admin' + url.search));"],
    ['subscription', '\t\t\t\t\t\t\t订阅内容 = Clash订阅配置文件热补丁(订阅内容, config_JSON);', `\t\t\t\t\t\t\t订阅内容 = Clash订阅配置文件热补丁(订阅内容, config_JSON);
                            try { 订阅内容 = 链式代理.patch(订阅内容, config_JSON.链式代理); }
                            catch (error) {
                                console.warn('[链式代理] 订阅生成失败:', error.name);
                                return new Response('链式代理订阅生成失败，请检查落地节点配置和订阅转换结果。', { status: 422, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' } });
                            }`],
    ['config', '\tif (!config_JSON.订阅转换配置.SUBLIST) config_JSON.订阅转换配置.SUBLIST = false;', `    // Read on every configuration load, including initialization and reset.
    try { config_JSON.链式代理 = await 链式代理.read(env.KV, config_JSON.链式代理); }
    catch {
        console.warn('[链式代理] chain-proxy.json 无效');
        config_JSON.链式代理 = { 启用: true, 中转节点列表: [], 错误: 'chain-proxy.json 无效' };
    }
\tif (!config_JSON.订阅转换配置.SUBLIST) config_JSON.订阅转换配置.SUBLIST = false;`],
];

export function stripExtensions(source) {
    let core = source.replace(/^\/\/ BEGIN EDGETUNNEL2:extension\n[\s\S]*?^\/\/ END EDGETUNNEL2:extension\n/m, '');
    for (const [name, original] of hooks) {
        const pattern = new RegExp('^// BEGIN EDGETUNNEL2:' + name + '\\n[\\s\\S]*?^// END EDGETUNNEL2:' + name + '\\n', 'm');
        core = core.replace(pattern, () => original + '\n');
    }
    return core;
}

export async function buildWorker(source) {
    let core = stripExtensions(source.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n'));
    for (const [name, original, replacement] of hooks) {
        const anchor = '\n' + original + '\n';
        if (core.split(anchor).length !== 2) throw new Error('上游结构发生变化，需要人工核对集成位置: ' + name);
        core = core.replace(anchor, () => '\n// BEGIN EDGETUNNEL2:' + name + '\n' + replacement + '\n// END EDGETUNNEL2:' + name + '\n');
    }
    const yaml = await readFile(resolve(root, 'vendor/js-yaml.min.cjs'), 'utf8');
    const extension = await readFile(resolve(root, 'extensions/chain-proxy.js'), 'utf8');
    const ui = await readFile(resolve(root, 'extensions/chain-proxy-ui.js'), 'utf8');
    const html = '<script id="edgetunnel2-chain-ui">\n' + ui + '\n</script>';
    return '// BEGIN EDGETUNNEL2:extension\n' +
        'const EdgeTunnelChainYAML = (() => { const module = { exports: {} }, exports = module.exports;\n' + yaml + '\nreturn module.exports; })();\n' +
        'const EdgeTunnelChainUI = ' + JSON.stringify(html) + ';\n' + extension +
        '// END EDGETUNNEL2:extension\n' + core;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const args = process.argv.slice(2);
    const input = args.includes('--upstream') ? resolve(args[args.indexOf('--upstream') + 1]) : resolve(root, '_worker.js');
    const output = args.includes('--output') ? resolve(args[args.indexOf('--output') + 1]) : resolve(root, '_worker.js');
    const built = await buildWorker(await readFile(input, 'utf8'));
    if (args.includes('--check')) {
        if (built !== await readFile(output, 'utf8')) throw new Error('_worker.js 与扩展源码不同步，请运行 npm run build');
        console.log('Worker bundle is up to date.');
    } else {
        await writeFile(output, built);
        console.log('Built ' + output);
    }
}
