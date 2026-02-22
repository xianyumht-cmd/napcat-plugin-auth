import fs from 'fs';
import path from 'path';

export async function onInit(context: any) {
    const api = context.onebot;
    if (!api) return;

    // --- 1. 基础配置与路径初始化 ---
    const DATA_DIR = path.join(process.cwd(), 'config', 'commercial_data');
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

    const AUTH_FILE = path.join(DATA_DIR, 'auth_list.json');
    const WB_FILE = path.join(DATA_DIR, 'word_bank.json');
    const CONFIG_FILE = path.join(DATA_DIR, 'group_configs.json');

    const DEFAULT_GROUP_CONF = {
        qr_recall: false,
        repeat_limit: 3,
        antispam_active: true,
        auto_join: true
    };

    // --- 2. 工具函数 ---
    const load = (f: string) => { 
        try { return JSON.parse(fs.readFileSync(f, 'utf8')); } 
        catch (e) { return {}; } 
    };
    const save = (f: string, d: any) => fs.writeFileSync(f, JSON.stringify(d, null, 4), 'utf8');

    // 自动撤回发送函数
    const sendAutoWithdraw = async (gid: string, text: string, delay: number = 60000) => {
        const res = await api.sendGroupMsg(gid, text);
        if (res?.message_id) {
            setTimeout(() => api.deleteMsg(res.message_id).catch(() => {}), delay);
        }
    };

    const MSG_HISTORY: Record<string, Record<string, [string, number]>> = {};

    console.log("------------------------------------------");
    console.log("🚀 [AuthPlugin] 商业版全逻辑(Vite构建)已就绪");
    console.log("------------------------------------------");

    // --- 3. 自动化处理：入群邀请 ---
    api.on('request.group.invite', async (req: any) => {
        const superusers = (context.config?.superusers || []).map(String);
        const isSuper = superusers.includes(req.user_id.toString());
        
        const configs = load(CONFIG_FILE);
        const globalConf = configs.global || { auto_join: true };

        if (isSuper || globalConf.auto_join) {
            await api.setGroupAddRequest(req.flag, req.sub_type, true);
            console.log(`[AuthPlugin] 自动同意入群: ${req.group_id}`);
        }
    });

    // --- 4. 核心消息处理逻辑 ---
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

        // A. 超级管理员授权指令 (授权 群号 天数)
        if (isSuper && raw.startsWith('授权')) {
            const p = raw.split(/\s+/);
            if (p.length === 3) {
                const targetGid = p[1];
                const days = parseInt(p[2]);
                auth[targetGid] = Math.floor(Date.now() / 1000) + (days * 86400);
                save(AUTH_FILE, auth);
                return api.sendGroupMsg(gid, `✅ 授权成功：群 ${targetGid} 有效期 ${days} 天`);
            }
        }

        // B. 权限校验 (非超级管理员且未授权或到期的群，不执行后续逻辑)
        const expireTime = auth[gid] || 0;
        const isExpired = expireTime < (Date.now() / 1000);
        if (!isSuper && isExpired) return;

        // C. 管理指令：设置
        if (isAdmin && raw.startsWith('设置')) {
            const p = raw.split(/\s+/);
            if (p.length >= 2) {
                const [key, val] = [p[1], p[2]];
                if (key === '二维码') gConf.qr_recall = (val === '开');
                if (key === '刷屏次数') gConf.repeat_limit = parseInt(val);
                if (key === '自动入群') {
                    configs.global = configs.global || {};
                    configs.global.auto_join = (val === '开');
                }
                configs[gid] = gConf;
                save(CONFIG_FILE, configs);
                return sendAutoWithdraw(gid, `⚙️ 设置更新：${key} -> ${val}`);
            }
        }

        // D. 管理指令：词库添加 (精确问...答...)
        if (isAdmin && raw.startsWith('精确问')) {
            const content = raw.replace('精确问', '').trim();
            if (content.includes('答')) {
                const [q, a] = content.split('答').map((s: string) => s.trim());
                if (!wb[gid]) wb[gid] = { exact: {}, fuzzy: {} };
                wb[gid].exact[q] = a;
                save(WB_FILE, wb);
                return sendAutoWithdraw(gid, `✅ 词库已添加: ${q}`);
            }
        }

        // E. 菜单展示
        if (raw === '菜单' || raw === '帮助') {
            const dateStr = isSuper ? "无限期" : new Date(expireTime * 1000).toLocaleString();
            const helpMsg = `--- 🤖 商业管理菜单 ---\n` +
                          `群组状态：${isExpired ? '🔴未授权' : '🟢已授权'}\n` +
                          `到期时间：${dateStr}\n\n` +
                          `1. 精确问 [词] 答 [内容]\n` +
                          `2. 设置 [二维码/刷屏次数] [开/关/数字]\n` +
                          `3. 设置 自动入群 [开/关] (全局)\n` +
                          `4. 授权 [群号] [天数] (仅限老板)`;
            return sendAutoWithdraw(gid, helpMsg);
        }

        // F. 安全防护逻辑 (针对普通成员)
        if (!isAdmin) {
            // 1. 二维码/图片撤回
            if (gConf.qr_recall && msg.message.some((m: any) => m.type === 'image')) {
                return api.deleteMsg(msg.message_id);
            }
            // 2. 防刷屏逻辑
            if (gConf.antispam_active) {
                const normMsg = raw.replace(/\s+/g, '').toLowerCase();
                if (!MSG_HISTORY[gid]) MSG_HISTORY[gid] = {};
                let userHist = MSG_HISTORY[gid][uid] || ["", 0];

                if (normMsg === userHist[0] && normMsg !== "") {
                    userHist[1]++;
                } else {
                    userHist = [normMsg, 1];
                }
                MSG_HISTORY[gid][uid] = userHist;

                if (userHist[1] >= gConf.repeat_limit) {
                    return api.deleteMsg(msg.message_id);
                }
            }
        }

        // G. 词库回复匹配
        const gWB = wb[gid] || { exact: {}, fuzzy: {} };
        // 精确匹配
        let reply = gWB.exact[raw];
        // 模糊匹配 (如果精确匹配没中)
        if (!reply) {
            const fuzzyKey = Object.keys(gWB.fuzzy || {}).find(k => raw.includes(k));
            if (fuzzyKey) reply = gWB.fuzzy[fuzzyKey];
        }

        if (reply) {
            await send_random_delay(500, 1500);
            return sendAutoWithdraw(gid, reply);
        }
    });

    // 辅助：随机延迟函数
    function send_random_delay(min: number, max: number) {
        return new Promise(resolve => setTimeout(resolve, Math.floor(Math.random() * (max - min + 1) + min)));
    }

    // --- 5. 授权过期预警任务 ---
    setInterval(async () => {
        const auth = load(AUTH_FILE);
        const now = Math.floor(Date.now() / 1000);
        for (const [gid, expire] of Object.entries(auth)) {
            const diff = (expire as number) - now;
            // 如果距离到期还有 23-24 小时之间，发一次提醒
            if (diff > 23 * 3600 && diff < 24 * 3600) {
                api.sendGroupMsg(gid, "🔔 【系统预警】本群授权即将于 24 小时内到期，请及时续费。").catch(() => {});
            }
        }
    }, 3600000); // 每小时检查一次
}

export default { onInit };
