import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { createHash, webcrypto } from 'node:crypto';
import { createRequire } from 'node:module';
import { buildWorker, stripExtensions } from '../scripts/build.mjs';

const require = createRequire(import.meta.url);
const yaml = require('../vendor/js-yaml.min.cjs');
const source = await readFile(process.env.EDGE_WORKER_FILE || new URL('../_worker.js', import.meta.url), 'utf8');
const uuid = '12345678-1234-4234-8234-123456789abc';
const landing = { name: '家宽: "A" #出口', type: 'socks5', server: 'exit.example.net', port: 1080, username: 'false', password: 'a: b #c "d"\\e\nf', udp: false };
const settings = nodes => ({ 启用: true, 当前选择: null, 中转节点列表: nodes || [landing] });
const fixture = `mixed-port: 7890
proxies:
  - {name: 'CF "HKG", 01', type: vless, server: 1.1.1.1, port: 443, uuid: 00000000-0000-4000-8000-000000000000, tls: true, network: ws, ws-opts: {path: /, headers: {Host: example.com}}}
proxy-groups:
  - {name: 🚀 节点选择, type: select, proxies: ['CF "HKG", 01', DIRECT]}
rules:
  - MATCH,🚀 节点选择
`;
const clone = value => JSON.parse(JSON.stringify(value));

function runtime(fetcher = async () => { throw new Error('Unexpected network request'); }) {
    const context = vm.createContext({
        console, Request, Response, Headers, URL, URLSearchParams, TextEncoder, TextDecoder,
        Uint8Array, ArrayBuffer, DataView, atob, btoa, performance, setTimeout, clearTimeout,
        ReadableStream, WritableStream, TransformStream, fetch: fetcher,
        crypto: { subtle: { digest: async (algorithm, input) => {
            if (String(algorithm).toUpperCase() !== 'MD5') return webcrypto.subtle.digest(algorithm, input);
            const bytes = createHash('md5').update(Buffer.from(input)).digest();
            return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
        } } }
    });
    vm.runInContext(source.replace('export default {', 'globalThis.worker = {') + '\n;globalThis.testing = { chain: 链式代理, readConfig: 读取config_JSON, hash: MD5MD5 };', context);
    return { ...context.testing, worker: context.worker };
}

function memoryKV() {
    const data = new Map();
    return { data, get: async key => data.get(key) ?? null, put: async (key, value) => { data.set(key, value); } };
}

function request(path, init = {}) {
    const req = new Request('https://worker.test' + path, { ...init, headers: { 'User-Agent': 'test-client', ...init.headers } });
    Object.defineProperty(req, 'cf', { value: { colo: 'HKG', asn: 13335, country: 'HK' } });
    return req;
}

async function session(fetcher) {
    const run = runtime(fetcher);
    const kv = memoryKV();
    const env = { KV: kv, ADMIN: 'test-password', UUID: uuid, OFF_LOG: 'true' };
    const pending = [];
    const ctx = { waitUntil: promise => pending.push(promise) };
    const login = await run.worker.fetch(request('/login', { method: 'POST', body: 'password=test-password' }), env, ctx);
    assert.equal(login.status, 200);
    const cookie = login.headers.get('set-cookie').split(';')[0];
    const call = (path, init = {}, overrides = {}) => run.worker.fetch(request(path, { ...init, headers: { Cookie: cookie, ...init.headers } }), { ...env, ...overrides }, ctx);
    return { ...run, kv, env, ctx, call, pending };
}

const { chain } = runtime();

test('disabled subscriptions are returned byte for byte', () => {
    assert.equal(chain.patch(fixture, { 启用: false }), fixture);
    assert.equal(chain.patch(fixture), fixture);
});

for (const [name, input] of [
    ['block', fixture],
    ['flow sections', yaml.dump(yaml.load(fixture), { flowLevel: 0 })],
    ['unindented lists', fixture.replace(/^  /gm, '')],
    ['CRLF', fixture.replace(/\n/g, '\r\n')],
    ['groups before proxies', (() => { const c = yaml.load(fixture); return yaml.dump({ 'proxy-groups': c['proxy-groups'], rules: c.rules, proxies: c.proxies }); })()],
    ['intervening section', fixture.replace('proxy-groups:', 'external-controller: 127.0.0.1:9090\nproxy-groups:')],
    ['quoted keys and anchors', 'proxies:\n  - &cf {name: CF, type: vless, server: 1.1.1.1, port: 443}\n"proxy-groups": [{name: Proxy, type: select, proxies: [CF]}]\nrules: [MATCH,Proxy]\n']
]) {
    test('valid CF → landing topology for ' + name, () => {
        const inputConfig = yaml.load(input), result = yaml.load(chain.patch(input, settings()));
        const transit = result['proxy-groups'].find(group => group.name === '🛫 链式中转');
        const mode = result['proxy-groups'].find(group => group.name === '🔗 链式模式');
        const exit = result.proxies.find(node => node.name === landing.name);
        assert.deepEqual(transit.proxies, inputConfig.proxies.map(node => node.name));
        assert.ok(!transit.proxies.includes('DIRECT'));
        assert.equal(exit['dialer-proxy'], transit.name);
        assert.deepEqual(mode.proxies, [exit.name]);
        assert.deepEqual({ ...exit, 'dialer-proxy': undefined }, { ...landing, 'dialer-proxy': undefined });
        assert.deepEqual(result.rules, inputConfig.rules);
        assert.equal(result['proxy-groups'][0].proxies[0], mode.name);
    });
}

test('all supported protocols retain TLS, nested options, arrays and string credentials', () => {
    const nodes = ['socks5', 'http', 'vless', 'vmess', 'trojan', 'ss'].map(type => ({
        ...landing, name: type, type, uuid, password: '123', cipher: 'aes-128-gcm', tls: true,
        'ws-opts': { path: '/path?a=b', headers: { Host: 'test.example.net' }, 'max-early-data': 2048 },
        alpn: ['h2', 'http/1.1'], 'reality-opts': { 'public-key': 'abc', 'short-id': '0123' }
    }));
    const result = yaml.load(chain.patch(fixture, settings(nodes)));
    for (const node of nodes) {
        const actual = result.proxies.find(proxy => proxy.name === node.name);
        assert.deepEqual({ ...actual, 'dialer-proxy': undefined }, { ...node, 'dialer-proxy': undefined });
    }
});

test('node and group collisions produce unique names and valid references', () => {
    const config = yaml.load(fixture);
    config.proxies.push({ name: '🛫 链式中转', type: 'http', server: 'cf.test', port: 443 });
    config['proxy-groups'].push({ name: '🔗 链式模式', type: 'select', proxies: ['DIRECT'] });
    const result = yaml.load(chain.patch(yaml.dump(config), settings([{ ...landing, name: config.proxies[0].name }])));
    const names = [...result.proxies, ...result['proxy-groups']].map(item => item.name);
    assert.equal(names.length, new Set(names).size);
    const exit = result.proxies.at(-1);
    assert.ok(result['proxy-groups'].some(group => group.name === exit['dialer-proxy']));
    assert.equal(result['proxy-groups'][0].proxies[0], '🔗 链式模式 (1)');
});

test('provider-only and node-only subscriptions contain usable transit groups', () => {
    const providers = yaml.load(chain.patch('proxy-providers: {CF: {type: http, url: "https://cf.test/sub"}}', settings()));
    assert.deepEqual(providers['proxy-groups'].at(-1).use, ['CF']);
    assert.equal(providers.proxies[0]['dialer-proxy'], providers['proxy-groups'].at(-1).name);
    const nodes = yaml.load(chain.patch('proxies: [{name: CF, type: http, server: cf.test, port: 443}]', settings()));
    assert.deepEqual(nodes['proxy-groups'].at(-1).proxies, ['CF']);
});

test('selected landing node is first and an empty transit set fails explicitly', () => {
    const options = settings([landing, { ...landing, name: 'second' }]);
    options.当前选择 = 'second';
    const result = yaml.load(chain.patch(fixture, options));
    assert.equal(result['proxy-groups'].find(group => group.name === '🔗 链式模式').proxies[0], 'second');
    assert.throws(() => chain.patch('proxies: []', options), /CF/);
});

test('validation rejects malformed config and normalizes legacy numeric ports', () => {
    assert.equal(chain.validate(settings([{ ...landing, port: '1080', type: 'SOCKS5' }])).中转节点列表[0].port, 1080);
    for (const value of [null, { 启用: 'true' }, settings([]), settings([landing, landing]), settings([{ ...landing, port: 65536 }]), settings([{ ...landing, type: 'unknown' }]), settings([{ ...landing, name: 'DIRECT' }]), settings([{ ...landing, type: 'vless' }])]) {
        assert.throws(() => chain.validate(value));
    }
});

test('admin endpoint requires the upstream cookie and supports GET/POST', async () => {
    const s = await session();
    const unauthenticated = await s.worker.fetch(request('/admin/chain-proxy.json'), s.env, s.ctx);
    assert.equal(unauthenticated.status, 302);
    assert.equal(unauthenticated.headers.get('location'), '/login');
    let response = await s.call('/admin/chain-proxy.json');
    assert.deepEqual(await response.json(), { 启用: false, 当前选择: null, 中转节点列表: [] });
    response = await s.call('/admin/chain-proxy.json', { method: 'POST', body: JSON.stringify(settings()), headers: { 'Content-Type': 'application/json' } });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).success, true);
    response = await s.call('/admin/chain-proxy.json');
    assert.deepEqual(await response.json(), settings());
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal((await s.call('/admin/chain-proxy.json', { method: 'DELETE' })).status, 405);
    const before = s.kv.data.get('chain-proxy.json');
    assert.equal((await s.call('/admin/chain-proxy.json', { method: 'POST', body: '{' })).status, 400);
    assert.equal(s.kv.data.get('chain-proxy.json'), before);
});

test('saved chain survives initial config creation, config reset and concurrent namespaces', async () => {
    const kv = memoryKV(), { readConfig } = runtime();
    await kv.put('chain-proxy.json', JSON.stringify(settings()));
    await kv.put('users.json', '[{"legacy":"keep"}]');
    let config = await readConfig({ KV: kv }, 'worker.test', uuid);
    assert.equal(config.链式代理.中转节点列表[0].password, landing.password);
    config = await readConfig({ KV: kv }, 'worker.test', uuid, 'test', true);
    assert.equal(config.链式代理.启用, true);
    const other = await readConfig({ KV: memoryKV() }, 'worker.test', uuid);
    assert.equal(other.链式代理.启用, false);
    assert.equal(kv.data.get('users.json'), '[{"legacy":"keep"}]');
});

test('legacy sub binding works while KV takes precedence', async () => {
    const s = await session(), other = memoryKV();
    const config = settings();
    await other.put('chain-proxy.json', JSON.stringify(config));
    assert.deepEqual(await (await s.call('/admin/chain-proxy.json', {}, { KV: undefined, sub: other })).json(), config);
    assert.equal((await (await s.call('/admin/chain-proxy.json', {}, { sub: other })).json()).启用, false);
});

test('admin HTML receives one chain settings UI and recalculated response headers', async () => {
    const s = await session(async () => new Response('<html><body>Upstream</body></html>', { headers: { 'Content-Type': 'text/html', 'Content-Length': '5', ETag: 'old' } }));
    const response = await s.call('/admin');
    const html = await response.text();
    assert.ok(html.includes('id="edgetunnel2-chain-ui"'));
    assert.ok(html.includes("fetch('/admin/chain-proxy.json'"));
    assert.equal(response.headers.get('content-length'), null);
    const injected = await s.chain.adminPage(new Response(html, { headers: { 'Content-Type': 'text/html' } }));
    assert.equal((await injected.text()).match(/id="edgetunnel2-chain-ui"/g).length, 1);
    const nested = '<html><body><template><html><body>inert</body></html></template>Outer</body></html>';
    const outer = await s.chain.adminPage(new Response(nested, { headers: { 'Content-Type': 'text/html' } }));
    const nestedHTML = await outer.text();
    assert.ok(nestedHTML.indexOf('id="edgetunnel2-chain-ui"') > nestedHTML.indexOf('</template>'));
});

test('real subscription route preserves UUID and generates CF → landing chain', async () => {
    const s = await session(async url => {
        assert.ok(String(url).includes('/sub?target=clash'));
        return new Response(fixture);
    });
    const config = await (await s.call('/admin/config.json')).json();
    config.优选订阅生成.本地IP库.随机IP = false;
    await s.kv.put('config.json', JSON.stringify(config));
    await s.kv.put('ADD.txt', '1.1.1.1:443#CF');
    await s.kv.put('chain-proxy.json', JSON.stringify(settings()));
    const token = await s.hash('worker.test' + uuid);
    let response = await s.call('/sub?target=clash&token=' + token);
    assert.equal(response.status, 200);
    const result = yaml.load(await response.text());
    assert.equal(result.proxies[0].uuid, uuid);
    assert.equal(result.proxies.at(-1)['dialer-proxy'], '🛫 链式中转');
    assert.deepEqual(result['proxy-groups'].at(-1).proxies, ['CF "HKG", 01']);
    await s.kv.put('chain-proxy.json', '{invalid');
    response = await s.call('/sub?target=clash&token=' + token);
    assert.equal(response.status, 422);
    assert.equal((await s.call('/admin/chain-proxy.json')).status, 500);
});

test('generated single-file worker is reproducible and upstream drift stops the build', async () => {
    assert.equal(await buildWorker(source), source);
    const core = stripExtensions(source);
    assert.ok(!core.includes('EDGETUNNEL2:'));
    const metadata = JSON.parse(await readFile(new URL('../upstream.json', import.meta.url), 'utf8'));
    assert.equal(createHash('sha256').update(core).digest('hex'), process.env.EDGE_UPSTREAM_SHA256 || metadata.core_sha256);
    await assert.rejects(buildWorker(core.replace('async fetch(request, env, ctx)', 'async fetch(request, env, context)')), /env/);
    const ui = await readFile(new URL('../extensions/chain-proxy-ui.js', import.meta.url), 'utf8');
    assert.doesNotThrow(() => new vm.Script(ui));
});
