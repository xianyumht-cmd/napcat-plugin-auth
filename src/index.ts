export async function onInit(context: any) {
    const api = context.onebot;
    console.log("------------------------------------------");
    console.log("✅ 商业授权插件已启动 (GitHub 构建版)");
    console.log("------------------------------------------");

    api.on('message.group', async (msg: any) => {
        if (msg.raw_message === '菜单') {
            await api.sendGroupMsg(msg.group_id, "🤖 插件运行正常！");
        }
    });
}
export default { onInit };
