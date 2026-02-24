export async function onInit(context: any) {
    const api = context.onebot;
    if (!api) return;

    // 动态引入 Node 模块，确保在 NapCat 环境下的稳定性
    const fs = await import('fs');
    const path = await import('path');

    // --- 基础路径配置 ---
    const DATA_DIR = path.join(process.cwd(), 'config', 'commercial_data');
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

    const AUTH_FILE = path.join(DATA_DIR, 'auth_list.json');
    const WB_FILE = path.join(DATA_DIR, 'word_bank.json');
    const CONFIG_FILE = path.join(DATA_DIR, 'group_configs.json');

    const DEFAULT_GROUP_CONF = { qr_recall: false, repeat_limit: 3, antispam_active: true, auto_join: true };

    // --- 工具函数 ---
    const load = (f: string) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { return {}; } };
    const save = (f: string, d: any) => fs.writeFileSync(f, JSON.stringify(d, null, 4), 'utf8');

    const sendAutoWithdraw = async (gid: string, text: string, delay: number = 60000) => {
        await new Promise(resolve => setTimeout(resolve, Math.random() * 1000 + 500));
        const res = await api.sendGroupMsg(gid, text);
        if (res?.message_id) {
            setTimeout(() => api.deleteMsg(res.message_id).catch(() => {}), delay);
        }
    };

    const MSG_HISTORY: any = {};

    console.log("------------------------------------------");
    console.log("✅ [AuthPlugin] 商业逻辑已通过 Vite 注入成功！");
    console.log("------------------------------------------");

    // --- 自动化处理：入群邀请 ---
    api.on('request.group.invite', async (req: any) => {
        const superusers = (context.config?.superusers || []).map(String);
        const isSuper = superusers.includes(req.user_id.toString());
        const configs = load(CONFIG_FILE);
        const globalConf = configs.global || { auto_join: true };
        if (isSuper || globalConf.auto_join) {
            await api.setGroupAddRequest(req.flag, req.sub_type, true);
        }
    });

    // --- 核心监控逻辑 ---
    api.on('message.group', async (msg: any) => {
        const gid = msg.group_id.toString();
        const uid = msg.user_id.toString();
        const raw = msg.raw_message.trim();
        const superusers = (context.config?.superusers || []).map(String);
        const isSuper = superusers.includes(uid);
        const isAdmin = msg.sender?.role !== 'member' || isSuper;

        let auth = load(AUTH_FILE);
        let configs = load(CONFIG_FILE);
        let wb = load(WB_FILE);
        let gConf = configs[gid] || { ...DEFAULT_GROUP_CONF };

        // A. 授权管理指令
        if (isSuper && raw.startsWith('授权')) {
            const p = raw.split(/\s+/);
            if (p.length === 3) {
                auth[p[1]] = Math.floor(Date.now() / 1000) + (parseInt(p[2]) * 86400);
                save(AUTH_FILE, auth);
                return api.sendGroupMsg(gid, `✅ 授权成功：群 ${p[1]} 有效期 ${p[2]} 天`);
            }
        }

        // B. 鉴权
        const expireTime = auth[gid] || 0;
        if (!isSuper && expireTime < (Date.now() / 1000)) return;

        // C. 设置指令
        if (isAdmin && raw.startsWith('设置')) {
            const p = raw.split(/\s+/);
            if (p.length >= 3) {
                const [k, v] = [p[1], p[2]];
                if (k === "二维码") gConf.qr_recall = (v === "开");
                else if (k === "刷屏次数") gConf.repeat_limit = parseInt(v);
                else if (k === "自动入群") { configs.global = configs.global || {}; configs.global.auto_join = (v === "开"); }
                configs[gid] = gConf;
                save(CONFIG_FILE, configs);
                return sendAutoWithdraw(gid, `⚙️ 系统设置已更新: ${k}`);
            }
        }

        // D. 词库录入
        if (isAdmin && (raw.startsWith('精确问') || raw.startsWith('模糊问'))) {
            const type = raw.startsWith('精确问') ? 'exact' : 'fuzzy';
            const content = raw.substring(3).trim();
            if (content.includes('答')) {
                const [q, a] = content.split('答').map((s: any) => s.trim());
                if (!wb[gid]) wb[gid] = { exact: {}, fuzzy: {} };
                wb[gid][type][q] = a;
                save(WB_FILE, wb);
                return sendAutoWithdraw(gid, `✅ 已添加${type === 'exact' ? '精确' : '模糊'}回复: ${q}`);
            }
        }

        // E. 菜单
        if (raw === '菜单' || raw === '帮助') {
            const date = isSuper ? "永久" : new Date(expireTime * 1000).toLocaleString();
            return sendAutoWithdraw(gid, `--- 🤖 商业管理菜单 ---\n授权到期：${date}\n1. 词库：精确问/模糊问 [词] 答 [内容]\n2. 设置：设置 [二维码/刷屏次数] [开/关/数字]\n3. 授权：授权 [群号] [天数]`);
        }

        // F. 防护逻辑
        if (!isAdmin) {
            if (gConf.qr_recall && msg.message.some((m: any) => m.type === 'image')) return api.deleteMsg(msg.message_id);
            if (gConf.antispam_active) {
                const normMsg = raw.replace(/\s+/g, '').toLowerCase();
                if (!MSG_HISTORY[gid]) MSG_HISTORY[gid] = {};
                let userHist = MSG_HISTORY[gid][uid] || ["", 0];
                if (normMsg === userHist[0] && normMsg !== "") userHist[1]++;
                else userHist = [normMsg, 1];
                MSG_HISTORY[gid][uid] = userHist;
                if (userHist[1] >= gConf.repeat_limit) return api.deleteMsg(msg.message_id);
            }
        }

        // G. 回复匹配
        const gWB = wb[gid] || { exact: {}, fuzzy: {} };
        const reply = gWB.exact[raw] || gWB.fuzzy[Object.keys(gWB.fuzzy).find(k => raw.includes(k)) || ""];
        if (reply) return sendAutoWithdraw(gid, reply);
    });

    // --- 5. 过期预警 ---
    setInterval(() => {
        const auth = load(AUTH_FILE);
        const now = Math.floor(Date.now() / 1000);
        for (const [gid, expire] of Object.entries(auth)) {
            const diff = (expire as number) - now;
            if (diff > 23 * 3600 && diff < 24 * 3600) api.sendGroupMsg(gid, "🔔 【系统预警】授权即将到期。").catch(() => {});
        }
    }, 3600000);
}
