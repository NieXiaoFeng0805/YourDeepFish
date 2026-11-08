/**
 * 小肥鱼 · DSH 插件宿主侧。
 *
 * 目前是纯客户端插件：宠物渲染在 `shell.overlay` 里，宿主侧不需要额外服务。
 * 后续要接本地内核（ws://127.0.0.1:45871）时，在这里暴露路由与状态。
 */
export const name = 'dsh-yourdeepfish';

export function apply() {
  // 宿主侧目前是空实现：宠物完全由客户端外壳渲染。
  // 这里故意不访问任何 ctx 服务，避免入口激活失败拖垮 web boot。
}
