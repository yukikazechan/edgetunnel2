// Kept separate from upstream networking code; scripts/build.mjs embeds this in _worker.js.
const 链式代理 = (() => {
    const key = 'chain-proxy.json';
    const supportedTypes = new Set(['socks5', 'http', 'vless', 'vmess', 'trojan', 'ss']);
    const defaults = () => ({ 启用: false, 当前选择: null, 中转节点列表: [] });
    const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
    const text = value => typeof value === 'string' && value.trim().length > 0;

    function validate(value) {
        if (!object(value) || typeof value.启用 !== 'boolean') throw new Error('启用字段必须是布尔值');
        const nodes = value.中转节点列表 ?? [];
        if (!Array.isArray(nodes)) throw new Error('中转节点列表必须是数组');
        const names = new Set();
        const normalized = nodes.map(node => {
            if (!object(node) || !text(node.name) || !text(node.type) || !text(node.server)) {
                throw new Error('每个落地节点必须包含 name、type、server 和 port');
            }
            const name = node.name.trim(), type = node.type.toLowerCase(), server = node.server.trim();
            const port = typeof node.port === 'string' && /^\d+$/.test(node.port) ? Number(node.port) : node.port;
            if (names.has(name) || ['DIRECT', 'REJECT', 'REJECT-DROP', 'PASS', 'GLOBAL'].includes(name.toUpperCase())) {
                throw new Error('落地节点名称重复或使用了保留名称');
            }
            if (!supportedTypes.has(type)) throw new Error('支持的类型为 socks5、http、vless、vmess、trojan、ss');
            if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('端口必须是 1–65535 的整数');
            if (/[\r\n\0]/.test(name + server) || /\s|:\/\//.test(server)) throw new Error('节点名称或服务器地址格式错误');
            if (['vless', 'vmess'].includes(type) && !/^[\da-f]{8}(-[\da-f]{4}){3}-[\da-f]{12}$/i.test(node.uuid || '')) {
                throw new Error('VLESS / VMess 节点必须填写有效的 uuid');
            }
            if (['trojan', 'ss'].includes(type) && !text(node.password)) throw new Error('Trojan / SS 节点必须填写 password');
            if (type === 'ss' && !text(node.cipher)) throw new Error('SS 节点必须填写 cipher');
            for (const field of ['username', 'password']) {
                if (node[field] !== undefined && typeof node[field] !== 'string') throw new Error(field + ' 必须是字符串');
            }
            names.add(name);
            return { ...node, name, type, server, port };
        });
        if (value.启用 && normalized.length === 0) throw new Error('启用链式代理前请至少添加一个落地节点');
        return { ...value, 启用: value.启用, 当前选择: value.当前选择 ?? null, 中转节点列表: normalized };
    }

    async function read(kv, fallback) {
        const raw = await kv.get(key);
        return raw === null || raw === undefined ? (fallback ? validate(fallback) : defaults()) : validate(JSON.parse(raw));
    }

    function json(body, status = 200, extra = {}) {
        return new Response(JSON.stringify(body), { status, headers: {
            'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...extra
        } });
    }

    // This handler is called only after the upstream admin cookie has been verified.
    async function handle(request, kv) {
        if (request.method === 'GET') {
            try { return json(await read(kv)); }
            catch { return json({ error: '读取链式代理配置失败，请检查 KV 中的 chain-proxy.json' }, 500); }
        }
        if (request.method !== 'POST') return json({ error: '仅支持 GET 和 POST' }, 405, { Allow: 'GET, POST' });
        let config;
        try { config = validate(await request.json()); }
        catch (error) { return json({ error: error instanceof SyntaxError ? '请求内容必须是有效 JSON' : error.message }, 400); }
        try { await kv.put(key, JSON.stringify(config, null, 2)); }
        catch { return json({ error: '保存链式代理配置失败，请检查 KV 绑定' }, 500); }
        return json({ success: true, message: '链式代理配置已保存' });
    }

    function patch(yamlContent, settings) {
        if (settings?.错误) throw new Error(settings.错误);
        if (!settings?.启用) return yamlContent;
        const chain = validate(settings);
        const config = EdgeTunnelChainYAML.load(yamlContent);
        if (!object(config)) throw new Error('订阅转换结果必须是 YAML 对象');
        if (config.proxies !== undefined && !Array.isArray(config.proxies)) throw new Error('proxies 必须是数组');
        if (config['proxy-groups'] !== undefined && !Array.isArray(config['proxy-groups'])) throw new Error('proxy-groups 必须是数组');
        const proxies = config.proxies ?? [], groups = config['proxy-groups'] ?? [];
        const transitNodes = proxies.map(node => node?.name).filter(text);
        const providers = object(config['proxy-providers']) ? Object.keys(config['proxy-providers']) : [];
        if (transitNodes.length === 0 && providers.length === 0) throw new Error('订阅中没有可用的 CF 中转节点');
        const usedNames = new Set([...transitNodes, ...groups.map(group => group?.name)]);
        function uniqueName(preferred) {
            let name = preferred, count = 1;
            while (usedNames.has(name)) name = preferred + ' (' + count++ + ')';
            usedNames.add(name);
            return name;
        }
        const chainName = uniqueName('🔗 链式模式'), transitName = uniqueName('🛫 链式中转');
        const landingNodes = chain.中转节点列表.map(node => ({ ...node, name: uniqueName(node.name), 'dialer-proxy': transitName }));
        const selected = chain.中转节点列表.findIndex(node => node.name === chain.当前选择);
        const landingNames = landingNodes.map(node => node.name);
        if (selected > 0) landingNames.unshift(...landingNames.splice(selected, 1));
        const selectors = groups.filter(group => object(group) && group.type === 'select');
        const main = selectors.find(group => /节点选择|代理选择|🚀|^(proxy|proxies|global)$/i.test(group.name)) || selectors[0];
        if (main) {
            if (main.proxies !== undefined && !Array.isArray(main.proxies)) throw new Error('主策略组的 proxies 必须是数组');
            main.proxies = [chainName, ...(main.proxies || [])];
        }
        const transitGroup = { name: transitName, type: 'select' };
        // Never add DIRECT: every landing connection must go through a CF node.
        if (transitNodes.length) transitGroup.proxies = [...new Set(transitNodes)];
        if (providers.length) transitGroup.use = providers;
        config.proxies = [...proxies, ...landingNodes];
        config['proxy-groups'] = [...groups, { name: chainName, type: 'select', proxies: landingNames }, transitGroup];
        return EdgeTunnelChainYAML.dump(config, { lineWidth: -1, quotingType: '"', forceQuotes: true });
    }

    async function adminPage(response) {
        if (!response.ok || !(response.headers.get('content-type') || '').includes('text/html')) return response;
        const html = await response.text();
        // Upstream contains an inert HTML document inside a <template>; inject at the outer body's end.
        const end = html.toLowerCase().lastIndexOf('</body>');
        const body = html.includes('id="edgetunnel2-chain-ui"') ? html : end >= 0
            ? html.slice(0, end) + EdgeTunnelChainUI + '\n' + html.slice(end)
            : html + EdgeTunnelChainUI;
        const headers = new Headers(response.headers);
        for (const header of ['content-length', 'content-encoding', 'etag']) headers.delete(header);
        headers.set('Cache-Control', 'no-store');
        return new Response(body, { status: response.status, statusText: response.statusText, headers });
    }

    return { defaults, validate, read, handle, patch, adminPage };
})();
