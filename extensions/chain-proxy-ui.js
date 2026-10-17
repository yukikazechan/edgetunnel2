// Runs on the current upstream admin page and the optional standalone Pages frontend.
(() => {
    function start() {
        if (document.getElementById('edgetunnel-chain-launcher')) return;
        const button = document.createElement('button');
        button.id = 'edgetunnel-chain-launcher';
        button.type = 'button';
        button.className = 'btn btn-primary';
        button.textContent = '🔗 链式代理设置';
        button.style.cssText = 'margin-top:16px;width:100%';
        button.onclick = open;
        const container = document.querySelector('.card-container') || document.body;
        container.appendChild(button);
    }

    async function api(options) {
        const response = await fetch('/admin/chain-proxy.json', { cache: 'no-store', ...options });
        if (response.redirected || !(response.headers.get('content-type') || '').includes('application/json')) {
            throw new Error('登录已失效，请重新登录管理页面');
        }
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || '请求失败');
        return result;
    }

    async function open() {
        let config;
        try { config = await api(); }
        catch (error) { alert(error.message); return; }
        const dialog = document.createElement('dialog');
        dialog.setAttribute('aria-label', '链式代理设置');
        dialog.style.cssText = 'width:min(600px,90vw);max-height:85vh;border:0;border-radius:16px;padding:24px;background:#fff;color:#172033;box-sizing:border-box;overflow:auto';
        // All user-entered node data is assigned with textContent / value below.
        dialog.innerHTML = `
            <h2 style="margin-top:0">🔗 链式代理设置</h2>
            <p>连接顺序：本机 → CF 中转节点 → 落地代理。仅适用于 Clash Meta / Mihomo 订阅。</p>
            <label style="display:block;margin:16px 0"><input id="cp-enable" type="checkbox"> 启用链式代理</label>
            <div id="cp-list"></div>
            <fieldset style="margin:16px 0;padding:14px;border:1px solid #ddd;border-radius:10px">
                <legend>添加落地节点</legend>
                <label style="display:block">名称 <input id="cp-name" style="width:100%;box-sizing:border-box"></label>
                <label style="display:block;margin-top:10px">类型 <select id="cp-type"><option value="socks5">SOCKS5</option><option value="http">HTTP / HTTPS</option><option value="vless">VLESS</option><option value="vmess">VMess</option><option value="trojan">Trojan</option><option value="ss">Shadowsocks</option></select></label>
                <label style="display:block;margin-top:10px">服务器 <input id="cp-server" style="width:100%;box-sizing:border-box" placeholder="IP 或域名"></label>
                <label style="display:block;margin-top:10px">端口 <input id="cp-port" type="number" min="1" max="65535"></label>
                <label style="display:block;margin-top:10px">用户名 / UUID <input id="cp-user" autocomplete="off"></label>
                <label style="display:block;margin-top:10px">密码 <input id="cp-password" type="password" autocomplete="off"></label>
                <label style="display:block;margin-top:10px">SS 加密方式 <input id="cp-cipher" placeholder="aes-128-gcm"></label>
                <label style="display:block;margin-top:10px"><input id="cp-tls" type="checkbox"> TLS</label>
                <label style="display:block;margin-top:10px">高级选项（JSON，可填写 ws-opts、sni 等）<textarea id="cp-extra" rows="3" style="display:block;width:100%;box-sizing:border-box" placeholder='{}'></textarea></label>
                <button id="cp-add" type="button" class="btn btn-secondary" style="margin-top:12px">添加节点</button>
            </fieldset>
            <details><summary>完整配置 JSON（可编辑已有节点）</summary><textarea id="cp-json" rows="10" spellcheck="false" style="width:100%;box-sizing:border-box"></textarea><button id="cp-apply" type="button">应用 JSON</button></details>
            <p id="cp-status" role="status" style="color:#b42318;white-space:pre-wrap"></p>
            <div style="display:flex;gap:12px;margin-top:20px"><button id="cp-close" type="button" class="btn btn-secondary">取消</button><button id="cp-save" type="button" class="btn btn-primary">保存配置</button></div>`;
        const $ = selector => dialog.querySelector(selector);
        const status = message => { $('#cp-status').textContent = message; };
        let jsonDirty = false;
        $('#cp-json').oninput = () => { jsonDirty = true; };
        function applyJSON() {
            const next = JSON.parse($('#cp-json').value);
            if (!next || typeof next.启用 !== 'boolean' || !Array.isArray(next.中转节点列表)) throw new Error('JSON 必须包含启用状态和中转节点列表');
            config = next;
            $('#cp-enable').checked = config.启用;
            jsonDirty = false;
        }
        function render() {
            const list = $('#cp-list');
            list.replaceChildren();
            for (const [index, node] of config.中转节点列表.entries()) {
                const row = document.createElement('div');
                row.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:12px;padding:8px 0';
                const label = document.createElement('span');
                label.textContent = node.name + ' · ' + node.type + ' · ' + node.server + ':' + node.port;
                const remove = document.createElement('button');
                remove.type = 'button';
                remove.textContent = '删除';
                remove.onclick = () => { config.中转节点列表.splice(index, 1); render(); };
                row.append(label, remove);
                list.appendChild(row);
            }
            if (!config.中转节点列表.length) list.textContent = '暂无落地节点';
            config.启用 = $('#cp-enable').checked;
            $('#cp-json').value = JSON.stringify(config, null, 2);
            jsonDirty = false;
        }
        $('#cp-enable').checked = config.启用;
        $('#cp-enable').onchange = () => {
            if (jsonDirty) { status('请先应用已编辑的 JSON'); return; }
            render();
        };
        $('#cp-apply').onclick = () => {
            try { applyJSON(); render(); status('JSON 已应用，保存后生效'); }
            catch (error) { status(error.message); }
        };
        $('#cp-add').onclick = () => {
            try {
                if (jsonDirty) throw new Error('请先应用已编辑的 JSON');
                const extra = JSON.parse($('#cp-extra').value || '{}');
                if (!extra || Array.isArray(extra) || typeof extra !== 'object') throw new Error('高级选项必须是 JSON 对象');
                const type = $('#cp-type').value;
                const node = { ...extra, name: $('#cp-name').value.trim(), type, server: $('#cp-server').value.trim(), port: Number($('#cp-port').value) };
                if (!node.name || !node.server || !Number.isInteger(node.port) || node.port < 1 || node.port > 65535) throw new Error('请填写名称、服务器和有效端口');
                if (config.中转节点列表.some(item => item.name === node.name)) throw new Error('节点名称重复');
                const user = $('#cp-user').value, password = $('#cp-password').value;
                if (['vless', 'vmess'].includes(type)) node.uuid = user;
                else if (user) node.username = user;
                if (password) node.password = password;
                if (type === 'ss') node.cipher = $('#cp-cipher').value.trim();
                if ($('#cp-tls').checked) node.tls = true;
                config.中转节点列表.push(node);
                render(); status('节点已添加，保存后生效');
                for (const id of ['cp-name', 'cp-server', 'cp-port', 'cp-user', 'cp-password', 'cp-cipher', 'cp-extra']) $('#' + id).value = '';
            } catch (error) { status(error.message); }
        };
        $('#cp-save').onclick = async () => {
            const save = $('#cp-save');
            try {
                if (jsonDirty) applyJSON();
                config.启用 = $('#cp-enable').checked;
                save.disabled = true;
                status('保存中…');
                await api({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(config) });
                dialog.close();
            } catch (error) { status(error.message); }
            finally { save.disabled = false; }
        };
        $('#cp-close').onclick = () => dialog.close();
        dialog.onclose = () => dialog.remove();
        document.body.appendChild(dialog);
        render();
        dialog.showModal();
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
    else start();
})();
