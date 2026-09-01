// ==UserScript==
// @name         MWI 快速出售助手
// @namespace    http://tampermonkey.net/
// @version      0.6.9
// @description  银河牛奶放置库存快速出售辅助：批量挂单出售库存物品，自动选品、跳转、填最佳报价与最大数量，出售动作由用户确认；不调用游戏接口
// @author       sunrishe
// @match        https://milkywayidle.com/*
// @match        https://milkywayidlecn.com/*
// @match        https://www.milkywayidle.com/*
// @match        https://www.milkywayidlecn.com/*
// @noframes
// @grant        none
// @run-at       document-idle
// @license      MIT
// @homepage     https://github.com/sunrishe/tampermonkey/tree/master/mwi/milkyway-sell
// @updateURL    https://raw.githubusercontent.com/sunrishe/tampermonkey/master/mwi/milkyway-sell/milkyway-sell.meta.js
// @downloadURL  https://raw.githubusercontent.com/sunrishe/tampermonkey/master/mwi/milkyway-sell/milkyway-sell.user.js
// ==/UserScript==

(function () {
  'use strict';

  // 单例守护：同一页面只允许一个实例（防止正式版/DEV 版等多份脚本重复注入，导致面板多实例混乱）
  if (window.__MWI_PLCS_GUARD__) return;
  window.__MWI_PLCS_GUARD__ = true;

  // ============================================================
  // 工具
  // ============================================================

  // 本脚本本地存储只用这一个 key：{ ignored: string[], settings: {...} }
  const STORE_KEY = 'mwi-plcs.data.v1';
  // 出售报价：默认出售报价 / 最佳出售报价（左一）/ 最佳购买报价（右一）
  const SELL_OPTION_DEFAULT = 'default';
  const SELL_OPTION_BEST_ASK = 'bestAsk';
  const SELL_OPTION_BEST_BID = 'bestBid';
  // 默认排除规则：食物（food）、饮料（drink）分类；单价超过 50M；总价低于 1M（均以 M 为单位配置，需勾选启用；总价默认不勾选）；
  // 右一价扣税后低于商人价不出售（默认开启，保护性规则）
  const DEFAULT_SETTINGS = {
    sellOption: SELL_OPTION_DEFAULT,
    excludeFood: true,
    excludeDrink: true,
    enableMaxUnitValue: true,
    maxUnitValue: 50, // 单位 M
    enableMinTotalValue: false,
    minTotalValue: 1, // 单位 M
    skipBelowVendor: true,
  };

  function log(...args) {
    console.log('[MWI-快速出售]', ...args.map((a) => (typeof a === 'object' && a !== null ? JSON.stringify(a) : a)));
  }

  /** 按 CSS module 前缀找元素（哈希类名随构建变化，前缀是稳定锚点） */
  function qCls(prefix, root) {
    root = root || document;
    return root.querySelector('[class*="' + prefix + '"]');
  }
  function waitMs(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }
  /** 轮询等待，返回命中值；running=false 时抛「已停止」 */
  async function waitFor(fn, timeoutMs, intervalMs) {
    const start = Date.now();
    intervalMs = intervalMs || 250;
    while (Date.now() - start < timeoutMs) {
      if (running === false) throw new Error('已停止');
      try {
        const v = fn();
        if (v) return v;
      } catch (e) { /* 忽略瞬时错误 */ }
      await waitMs(intervalMs);
    }
    return null;
  }

  // ---- React 实例访问（实机验证：DOM 元素无 fiber 键，需从 #root 的 fiber 向下走）----

  function rootFiber() {
    const root = document.querySelector('#root');
    return (root && root._reactRootContainer && root._reactRootContainer.current) || null;
  }

  /** 遍历 fiber 树，找具备某特征的小程序 stateNode */
  function findInst(predicate) {
    const fiber = rootFiber();
    if (!fiber) return null;
    const seen = new Set();
    let hit = null;
    const walk = (f) => {
      if (!f || hit || seen.has(f)) return;
      seen.add(f);
      const sn = f.stateNode;
      if (sn && typeof sn === 'object' && predicate(sn)) hit = sn;
      if (!hit && f.child) walk(f.child);
      if (!hit && f.sibling) walk(f.sibling);
    };
    walk(fiber);
    return hit;
  }

  /** 游戏全局状态（GamePage 实例 state：characterItemMap / itemDetailDict / myMarketListingMap 等） */
  function getGameState() {
    const inst = findInst((sn) => sn.state && sn.state.characterItemMap && sn.state.myMarketListingMap);
    return inst ? inst.state : null;
  }

  /** 市场面板组件实例（含 marketItems / handleShowNewPostListing / handleHidePostListing） */
  function getMarketInst() {
    return findInst((sn) => sn.state && Array.isArray(sn.state.marketItems) && typeof sn.handleShowNewPostListing === 'function');
  }

  /** 游戏宿主实例（GamePage）：游戏对象自带的导航方法（handleChangeNavTarget / handleGoToMarketplace 等） */
  function getGameHost() {
    return findInst((sn) => typeof sn.handleChangeNavTarget === 'function');
  }

  // ---- 数据读取 ----

  /** 官方市场价值（游戏自己维护在 localStorage，实机验证 872 项） */
  function marketValue(itemHrid) {
    try {
      const lsu = window.localStorageUtil;
      if (lsu && typeof lsu.getMarketItemValues === 'function') {
        const { marketItemValues } = lsu.getMarketItemValues() || {};
        const row = marketItemValues && marketItemValues[itemHrid];
        const v = row && (row['0'] ?? row[0]);
        return Number(v) > 0 ? Number(v) : 0;
      }
    } catch (e) { /* ignore */ }
    return 0;
  }

  /** 本地化物品名（市场面板 marketItems 里的 name 是当前语言） */
  function localizedName(itemHrid) {
    const inst = getMarketInst();
    if (inst) {
      const m = inst.state.marketItems.find((i) => i.itemHrid === itemHrid);
      if (m && m.name) return m.name;
    }
    const st = getGameState();
    const d = st && st.itemDetailDict && st.itemDetailDict[itemHrid];
    return (d && d.name) || itemHrid.split('/').pop() || itemHrid;
  }

  /**
   * 读订单簿一级（左一/右一）：marketItemOrderBooks.orderBooks[等级].asks/bids[0] = {price, quantity}。
   * 数量为该价格档位所有挂单的数量总和（同价聚合），非首位单档数量。
   * 返回 { ask, bid }，缺失时为 null（与游戏 getBestAskPrice/getBestBidPrice 同源）。
   */
  function readOrderBookLevel0(inst) {
    inst = inst || getMarketInst();
    if (!inst || !inst.state) return { ask: null, bid: null };
    const ob = inst.state.marketItemOrderBooks;
    if (!ob || !ob.orderBooks || ob.itemHrid !== inst.state.itemHrid) return { ask: null, bid: null };
    const lv = String(inst.state.enhancementLevel || inst.state.enhancementLevelInput || 0);
    const book = ob.orderBooks[lv];
    if (!book) return { ask: null, bid: null };
    // 同价聚合：统计与首位同价的所有挂单数量之和
    const sumQtyAt = (rows, price) => {
      let sum = 0;
      for (const r of rows || []) {
        if (r && r.price === price) sum += Number(r.quantity) || 0;
      }
      return sum;
    };
    const ask0 = (book.asks && book.asks[0]) || null;
    const bid0 = (book.bids && book.bids[0]) || null;
    return {
      ask: ask0 ? { price: ask0.price, quantity: sumQtyAt(book.asks, ask0.price) } : null,
      bid: bid0 ? { price: bid0.price, quantity: sumQtyAt(book.bids, bid0.price) } : null,
    };
  }

  /** 市场税率：牛铃袋 18%，其余 5%（源码常量 TAX_RATE/COWBELL_TAX_RATE） */
  function taxRateOf(itemHrid) {
    return itemHrid === '/items/bag_of_10_cowbells' ? 0.18 : 0.05;
  }
  /** 商人价（商店售价）：itemDetailDict[itemHrid].sellPrice */
  function vendorPriceOf(itemHrid) {
    const st = getGameState();
    const d = st && st.itemDetailDict && st.itemDetailDict[itemHrid];
    return d ? Number(d.sellPrice) || 0 : 0;
  }
  /**
   * 游戏价格档位步长（getBinnedPrice，源码 31318 行）：按首位数定步长，<1000 为 1 不取档。
   * 1、2 → 5×10^(位数-4)；3、4 → 1×10^(位数-3)；5-9 → 2×10^(位数-3)。即 1/2 开头同档（如 7 位都是 5000），
   * 档位跳变只发生在 2→3（5000→10000）、4→5（10000→20000）、9→升位。
   */
  function binStep(price) {
    price = parseInt(price, 10);
    if (isNaN(price) || price <= 1) return 1;
    const lead = String(price)[0];
    const len = String(price).length;
    if (lead === '1' || lead === '2') return len >= 4 ? 5 * Math.pow(10, len - 4) : 1;
    if (lead === '3' || lead === '4') return len >= 3 ? Math.pow(10, len - 3) : 1;
    return len >= 3 ? 2 * Math.pow(10, len - 3) : 1;
  }
  /**
   * 左一/右一之间相差的档位数：从低价起按「+ 按钮」方式逐档上取整（当前价+1 → getBinnedPrice 向上取整，
   * 等价于每档加 binStep(当前价)），数到高价为止；无数据/异常时返回 null。
   */
  function diffBins(askPrice, bidPrice) {
    askPrice = Number(askPrice);
    bidPrice = Number(bidPrice);
    if (!(askPrice > 0) || !(bidPrice > 0)) return null;
    let cur = Math.min(askPrice, bidPrice);
    const hi = Math.max(askPrice, bidPrice);
    let steps = 0;
    while (cur < hi) {
      cur += binStep(cur);
      steps++;
      if (steps > 100000) return null; // 异常数据保护，防死循环
    }
    return steps;
  }

  /** 读取可出售库存：库存位置、0 强化、市场可交易、未屏蔽、未超单价上限、未低于总价下限，按总价值降序 */
  function readSellableItems() {
    const st = getGameState();
    if (!st) return [];
    // 市场面板的 marketItems 是官方可交易物品清单（不含金币、牛铃袋等）
    const tradable = new Set((getMarketInst()?.state.marketItems || []).map((m) => m.itemHrid));
    const ignored = readIgnored();
    const cfg = readSettings();
    const out = [];
    for (const stack of st.characterItemMap.values()) {
      if (!stack || stack.itemLocationHrid !== '/item_locations/inventory') continue;
      if (Number(stack.enhancementLevel) !== 0) continue;
      if (Number(stack.count) <= 0) continue;
      const detail = st.itemDetailDict && st.itemDetailDict[stack.itemHrid];
      if (!detail) continue;
      if (cfg.excludeFood && detail.categoryHrid === '/item_categories/food') continue;
      if (cfg.excludeDrink && detail.categoryHrid === '/item_categories/drink') continue;
      if (!(tradable.size ? tradable.has(stack.itemHrid) : detail.isTradable)) continue;
      if (ignored.has(stack.itemHrid)) continue;
      const value = marketValue(stack.itemHrid);
      const total = value * Number(stack.count);
      // 阈值以 M 为单位存储（cfg.maxUnitValue=50 表示 50M），启用时换算成具体金额比较
      if (cfg.enableMaxUnitValue && cfg.maxUnitValue > 0 && value > cfg.maxUnitValue * 1e6) continue;
      if (cfg.enableMinTotalValue && cfg.minTotalValue > 0 && total < cfg.minTotalValue * 1e6) continue;
      out.push({
        itemHrid: stack.itemHrid,
        name: localizedName(stack.itemHrid),
        count: Number(stack.count),
        value,
        total,
      });
    }
    out.sort((a, b) => b.total - a.total);
    return out;
  }

  // ---- 本地存储（单一 key：{ ignored: string[], settings: {...} }）----

  function readStore() {
    try {
      const raw = JSON.parse(localStorage.getItem(STORE_KEY) || 'null');
      if (raw && typeof raw === 'object' && Array.isArray(raw.ignored)) return raw;
      return { ignored: [], settings: {} };
    } catch (e) {
      return { ignored: [], settings: {} };
    }
  }
  function writeStore(patch) {
    try {
      const cur = readStore();
      localStorage.setItem(STORE_KEY, JSON.stringify(Object.assign({}, cur, patch)));
    } catch (e) { /* ignore */ }
  }

  // ---- 屏蔽清单 ----

  function readIgnored() {
    return new Set(readStore().ignored || []);
  }
  function addIgnored(itemHrid) {
    try {
      const set = readIgnored();
      set.add(itemHrid);
      writeStore({ ignored: [...set] });
    } catch (e) { /* ignore */ }
  }
  function removeIgnored(itemHrid) {
    try {
      const set = readIgnored();
      set.delete(itemHrid);
      writeStore({ ignored: [...set] });
    } catch (e) { /* ignore */ }
  }
  function clearIgnored() {
    try {
      writeStore({ ignored: [] });
    } catch (e) { /* ignore */ }
  }

  // ---- 设置（出售报价选项 + 排除规则）----

  function readSettings() {
    try {
      const raw = readStore().settings || {};
      const cfg = Object.assign({}, DEFAULT_SETTINGS, raw);
      cfg.maxUnitValue = Number(cfg.maxUnitValue) || 0;
      cfg.minTotalValue = Number(cfg.minTotalValue) || 0;
      if (![SELL_OPTION_DEFAULT, SELL_OPTION_BEST_ASK, SELL_OPTION_BEST_BID].includes(cfg.sellOption)) {
        cfg.sellOption = SELL_OPTION_DEFAULT;
      }
      return cfg;
    } catch (e) {
      return Object.assign({}, DEFAULT_SETTINGS);
    }
  }
  function saveSettings(patch) {
    try {
      writeStore({ settings: Object.assign({}, readSettings(), patch) });
    } catch (e) { /* ignore */ }
  }

  // ---- 图标（游戏 SVG 雪碧图 <use href="...items_sprite.svg#物品id尾段">）----

  let spriteBase = null;
  function getSpriteBase() {
    if (spriteBase !== null) return spriteBase;
    const use = document.querySelector('use[href*="items_sprite"], use[xlink\\:href*="items_sprite"]');
    if (use) {
      const href = use.getAttribute('href') || use.getAttribute('xlink:href') || '';
      const base = href.split('#')[0];
      if (base) return (spriteBase = base);
    }
    spriteBase = '';
    return spriteBase;
  }
  function itemIconSvg(itemHrid, sizeRem) {
    const base = getSpriteBase();
    if (!base) return '';
    const id = (itemHrid.split('/').pop() || '').replace(/[^a-z0-9_]/gi, '');
    sizeRem = sizeRem || 2;
    return '<svg style="width:' + sizeRem + 'rem;height:' + sizeRem + 'rem;display:block" viewBox="0 0 32 32" aria-hidden="true">' +
      '<use href="' + base + '#' + id + '"></use></svg>';
  }

  // ============================================================
  // 悬浮面板 UI
  // ============================================================

  const UI_CSS =
    /* 尺寸全部用 rem，与游戏对齐：游戏根字号随响应式媒体查询变化（桌面 14.4px / 窄屏 11.2px，1rem 随之缩放），
       游戏按钮字号 0.8125rem、圆角 0.25rem、小按钮高 1.5rem（实测） */
    '#mwiPlcsFloating{position:fixed;left:0.75rem;bottom:0.75rem;z-index:999999;font-family:Roboto,Helvetica,Arial,sans-serif;touch-action:none;}' +
    /* 入口按钮（市场 tab 行末尾，克隆游戏 tab 样式类）：success 金橙底色 + 深字，醒目易识别 */
    '#mwiPlcsTabEntry{background:#ee9a1d;color:#2a1a00;font-weight:600;cursor:pointer;}' +
    '#mwiPlcsTabEntry:hover{background:#f5a92e;}' +
    '#mwiPlcsPanel{display:none;flex-direction:column;margin-top:0.5rem;width:23.6rem;max-height:52vh;background:#171a22;border:0.0625rem solid #363b48;border-radius:0.625rem;padding:0.625rem;color:#dbe0ea;font-size:0.875rem;box-shadow:0 0.375rem 1.5rem rgba(0,0,0,.5);}' +
    '#mwiPlcsPanel.open{display:flex;}' +
    /* 标题行：固定在面板顶部不随内容滚动（flex 不收缩），可整体拖动；右侧放操作按钮与最小化 */
    '#mwiPlcsHeader{flex:0 0 auto;display:flex;align-items:center;gap:0.375rem;margin-bottom:0.375rem;padding-bottom:0.5rem;border-bottom:0.0625rem solid #2a2f3b;cursor:grab;user-select:none;}' +
    /* 面板内容区：仅此区域滚动（标题固定在其上方） */
    '#mwiPlcsBody{flex:1 1 auto;min-height:0;overflow-y:auto;overflow-x:hidden;}' +
    '#mwiPlcsTitle{flex:1;font-size:1rem;font-weight:700;color:#fff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;pointer-events:none;}' +
    '.mwiPlcsBtn{display:inline-flex;align-items:center;justify-content:center;padding:0.25rem 0.625rem;margin:0;border:none;border-radius:0.25rem;background:#2b3140;color:#dbe0ea;font-size:0.875rem;font-family:inherit;cursor:pointer;min-height:1.8rem;}' +
    '.mwiPlcsBtn:hover{background:#39415a;}' +
    '.mwiPlcsBtn.primary{background:#3d6b4f;color:#fff;}' +
    '.mwiPlcsBtn.danger{background:#6b3d3d;color:#fff;}' +
    '.mwiPlcsBtn.small{padding:0.1875rem 0.5rem;font-size:0.8125rem;}' +
    '#mwiPlcsMin{min-width:1.125rem;}' +
    /* 设置区块（默认展开）：出售选项 + 排除规则 */
    '#mwiPlcsSettings{margin-top:0.375rem;padding:0.5rem;background:#131722;border:0.0625rem solid #262b37;border-radius:0.25rem;}' +
    '#mwiPlcsSettings .sec{font-weight:600;color:#9fb0c8;margin:0.25rem 0 0.375rem;}' +
    '.mwiPlcsSellOpt{display:flex;flex-wrap:wrap;gap:0.375rem;margin-bottom:0.5rem;}' +
    '.mwiPlcsSellOpt .mwiPlcsBtn{padding:0.25rem 0.5rem;font-size:0.8125rem;}' +
    '.mwiPlcsSellOpt .mwiPlcsBtn.on{background:#3d6b4f;color:#fff;}' +
    '#mwiPlcsCfgRows{display:flex;flex-wrap:wrap;gap:0.375rem 0.75rem;}' +
    /* 每个选项一行内「复选框+文字+输入框」贴近排列；多选项自动换行，放不下才折行 */
    '.mwiPlcsCfgRow{display:flex;align-items:center;gap:0.375rem;font-size:0.875rem;}' +
    '.mwiPlcsCfgRow label{cursor:pointer;color:#dbe0ea;display:flex;align-items:center;gap:0.375rem;white-space:nowrap;}' +
    '.mwiPlcsCfgRow input[type=checkbox]{width:0.95rem;height:0.95rem;accent-color:#3d6b4f;cursor:pointer;}' +
    '.mwiPlcsCfgRow input[type=number]{width:5.5rem;background:#0d1117;color:#dbe0ea;border:0.0625rem solid #2a2f3b;border-radius:0.25rem;padding:0.1875rem 0.375rem;font-family:inherit;font-size:0.875rem;}' +
    /* 未勾选（未启用）的排除规则整体置灰，与启用态明显区分 */
    '.mwiPlcsCfgRow.off label{color:#5b6577;}' +
    '.mwiPlcsCfgRow.off input[type=number]{color:#5b6577;border-color:#232833;}' +
    '.mwiPlcsCfgRow .suffix{color:#9fb0c8;font-size:0.8125rem;white-space:nowrap;}' +
    '#mwiPlcsCfgReset{width:100%;margin-top:0.5rem;}' +
    /* 已屏蔽列表：直接在标题下方展示，带图标与本地化名称 */
    '#mwiPlcsIgnoreList{background:#131722;border:0.0625rem solid #262b37;border-radius:0.25rem;padding:0.25rem 0.375rem;}' +
    '.mwiPlcsIgnoreHead{font-weight:600;color:#9fb0c8;padding:0.25rem 0;display:flex;align-items:center;justify-content:space-between;gap:0.5rem;}' +
    '.mwiPlcsIgnoreRow{display:flex;align-items:center;gap:0.5rem;padding:0.25rem 0;border-bottom:0.0625rem solid #262b37;}' +
    '.mwiPlcsIgnoreRow:last-child{border-bottom:none;}' +
    '.mwiPlcsIgnoreName{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}' +
    '#mwiPlcsQueue{max-height:9.5rem;overflow:auto;}' +
    /* 页面级提示 toast：悬浮在页面顶部居中，自动消失 */
    '#mwiPlcsToast{position:fixed;top:0.75rem;left:50%;transform:translateX(-50%);z-index:1000000;max-width:min(30rem,calc(100vw - 1.5rem));box-sizing:border-box;padding:0.625rem 1rem;background:#3a2f24;border:0.0625rem solid #6b4f2a;border-radius:0.375rem;color:#e8c78a;font-size:0.875rem;line-height:1.4;text-align:center;box-shadow:0 0.375rem 1.5rem rgba(0,0,0,.5);}' +
    /* 左一/右一可点击价格：下划线链接样式，hover 高亮 */
    '#mwiPlcsOrderLine a{color:#7fb3e8;text-decoration:underline;cursor:pointer;}' +
    '#mwiPlcsOrderLine a:hover{color:#a9d4ff;}' +
    /* 左一/右一整体（标签+价格）可点击下划线；左一暖橙、右一绿色区分；数量无下划线不参与点击 */
    '#mwiPlcsOrderLine .ob{cursor:pointer;text-decoration:underline;}' +
    '#mwiPlcsOrderLine .ob.ask{color:#e8a33d;}' +
    '#mwiPlcsOrderLine .ob.bid{color:#5fd38a;}' +
    '#mwiPlcsOrderLine .ob .qtyc{color:#9fb0c8;text-decoration:none;cursor:default;}' +
    /* 左/右中间「x 档」：常规色、无下划线、不可点击 */
    '#mwiPlcsOrderLine .obDiff{color:#9fb0c8;}' +
    /* 进度行：左右布局——左=进度（当前/总数+百分比），右=已屏蔽物品数 */
    '#mwiPlcsProgress{margin-top:0.375rem;padding:0.25rem 0.375rem;background:#1a2430;border:0.0625rem solid #2c4155;border-radius:0.25rem;justify-content:space-between;align-items:center;gap:0.5rem;}' +
    '#mwiPlcsProgress .pl{color:#cfe3f5;font-weight:600;}' +
    '#mwiPlcsProgress .pr{color:#9fb0c8;font-weight:400;font-size:0.8125rem;text-align:right;white-space:nowrap;}' +
    /* 队列条目：单行展示——图标 + 名称 + ×数量 + 总价值挤在一行，整条固定行高，内容再多也不变高 */
    '.mwiPlcsItem{padding:0.1875rem 0.375rem;margin:0.125rem 0;background:#1e2230;border:0.0625rem solid #2c3142;border-radius:0.25rem;display:flex;align-items:center;gap:0.5rem;min-width:0;height:1.6rem;box-sizing:border-box;}' +
    '.mwiPlcsItem.current{border-color:#4a7a5c;}' +
    '.mwiPlcsItem svg{flex:0 0 auto;display:block;}' +
    '.mwiPlcsItem .name{flex:1;min-width:0;font-weight:600;color:#eef;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}' +
    '.mwiPlcsItem .qty{color:#9fb0c8;font-size:0.8125rem;white-space:nowrap;}' +
    '.mwiPlcsItem .total{color:#cfe3f5;font-weight:600;font-size:0.8125rem;white-space:nowrap;text-align:right;}' +
    /* 移动端适配：窄屏时面板宽度适配视口、高度降低，避免大面积遮挡市场内容区 */
    '@media (max-width:45rem){' +
    '#mwiPlcsFloating{left:0.375rem;bottom:0.375rem;}' +
    '#mwiPlcsPanel{width:min(23.6rem,calc(100vw - 0.75rem));max-height:44vh;font-size:0.8125rem;z-index:999999;}' +
    '.mwiPlcsItem .qty,.mwiPlcsItem .total{font-size:0.75rem;}' +
    '}';

  function buildPanel() {
    try {
      const host = document.createElement('div');
      host.id = 'mwiPlcsFloating';
      floatHost = host; // 尽早登记，避免后续异常导致 watchdog 拿不到宿主
      host.innerHTML =
      '<style>' + UI_CSS + '</style>' +
      '<div id="mwiPlcsPanel">' +
      '  <div id="mwiPlcsHeader">' +
      '    <span id="mwiPlcsTitle">快速出售</span>' +
      '    <button class="mwiPlcsBtn danger" id="mwiPlcsStop" style="display:none"><svg width="0.85em" height="0.85em" viewBox="0 0 16 16" aria-hidden="true" style="display:inline-block;vertical-align:-0.08em;margin-right:0.25rem"><rect x="2.5" y="2.5" width="11" height="11" rx="1.5" fill="currentColor"/></svg>停止</button>' +
      '    <button class="mwiPlcsBtn primary" id="mwiPlcsStart">▶ 开始</button>' +
      '    <button class="mwiPlcsBtn" id="mwiPlcsMin" title="最小化">—</button>' +
      '  </div>' +
      '  <div id="mwiPlcsBody">' +
      '    <div id="mwiPlcsSettings"></div>' +
      '    <div id="mwiPlcsIgnoreList"></div>' +
      '    <div id="mwiPlcsProgress" style="display:none"><span class="pl" id="mwiPlcsProgressText"></span><span class="pr" id="mwiPlcsProgressIgnored"></span></div>' +
      '    <div id="mwiPlcsQueue"></div>' +
      '  </div>' +
      '</div>';
    document.body.appendChild(host);

    // 「—」最小化 → 收起面板、还原 tab 入口按钮（openPanel/closePanel 在模块作用域，
    // 点击展开逻辑挂在市场 tab 行末尾的入口按钮上，见 injectTabEntry）
    host.querySelector('#mwiPlcsMin').addEventListener('click', closePanel);

    // 窗口尺寸变化（resize / 移动端旋转）时把宿主钳制回可视区，
    // 否则 fixed 定位坐标不变，窗口变小后面板会跑出可视区
    window.addEventListener('resize', clampFloatHost);
    window.addEventListener('orientationchange', clampFloatHost);

    // 拖动：面板标题行支持（点击行内按钮不触发）。
    // 关键1：拖动开始先把 bottom 置为 auto，避免 fixed 元素同时 top+bottom 被拉伸变形；
    // 关键2：点击语义在 pointerup 里直接判定（位移 < 阈值 = 点击，不依赖浏览器合成的 click，
    //        避免手抖被误判为拖动导致面板打不开）；真拖动后吞掉随后的原生 click；
    // 关键3：拖动过程跟手但**不允许超出可视区**——移动目标钳制在 [0, 视口-面板尺寸] 内
    const DRAG_THRESHOLD = 8;
    let dragSuppress = false;
    const bindDrag = (el, onTap) => {
      let dragState = null;
      el.addEventListener('pointerdown', (e) => {
        if (e.target !== el && e.target.closest('button')) return;
        dragState = { x: e.clientX, y: e.clientY, left: host.offsetLeft, top: host.offsetTop, moved: false };
        host.style.bottom = 'auto';
        try { el.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
        e.preventDefault();
      });
      el.addEventListener('pointermove', (e) => {
        if (!dragState) return;
        const dx = e.clientX - dragState.x;
        const dy = e.clientY - dragState.y;
        if (Math.abs(dx) > DRAG_THRESHOLD || Math.abs(dy) > DRAG_THRESHOLD) dragState.moved = true;
        // 跟手但钳制在可视区内：不允许拖出视口
        const maxX = Math.max(0, window.innerWidth - host.offsetWidth);
        const maxY = Math.max(0, window.innerHeight - host.offsetHeight);
        host.style.left = Math.min(Math.max(0, dragState.left + dx), maxX) + 'px';
        host.style.top = Math.min(Math.max(0, dragState.top + dy), maxY) + 'px';
      });
      const endDrag = () => {
        if (dragState) {
          if (!dragState.moved && onTap) onTap(); // 无位移 = 点击
          else if (dragState.moved) dragSuppress = true; // 真拖动 → 吞掉随后的原生 click
        }
        dragState = null;
        clampFloatHost(); // 保险：再钳一次
        setTimeout(() => { dragSuppress = false; }, 0);
      };
      el.addEventListener('pointerup', endDrag);
      el.addEventListener('pointercancel', endDrag);
      el.addEventListener('click', (e) => {
        if (dragSuppress) { e.preventDefault(); e.stopPropagation(); dragSuppress = false; }
      });
    };
    bindDrag(host.querySelector('#mwiPlcsHeader'), null);

    renderSettings(); // 设置区块默认展开，构建时渲染一次（后续用户操作时自行重渲染）
    host.querySelector('#mwiPlcsStart').addEventListener('click', () => { startBatch(); });
    host.querySelector('#mwiPlcsStop').addEventListener('click', () => { running = false; clearHint(); clearBatchUI(); });
    watchDisconnect();
    } catch (e) {
      log('面板构建失败：' + (e && e.message));
    }
  }

  // ---- 掉线处理：不在游戏主页面（isFullDisconnected）时卸载组件，重新进入后自动重建 ----
  let floatHost = null;
  let watchdogTimer = null;

  /** 市场 tab 行末尾的入口按钮（由 injectTabEntry 注入到游戏 tab 栏） */
  function tabEntry() {
    return document.querySelector('#mwiPlcsTabEntry');
  }
  /** 展开面板：刷新忽略列表与设置，并把宿主钳回可视区（防止拖动过后面板部分不可见）；入口按钮保持可见 */
  function openPanel() {
    const panel = document.querySelector('#mwiPlcsPanel');
    if (!panel) return;
    panel.classList.add('open');
    renderSettings();
    renderIgnoreList();
    if (!floatHost) return;
    const pr = panel.getBoundingClientRect();
    const hostH = floatHost.offsetHeight;
    if (pr.top < 0) floatHost.style.top = '0px';
    else if (pr.bottom > window.innerHeight) floatHost.style.top = Math.max(0, window.innerHeight - hostH) + 'px';
  }
  /** 收起面板：「—」最小化收起（入口按钮常驻可见） */
  function closePanel() {
    const panel = document.querySelector('#mwiPlcsPanel');
    if (panel) panel.classList.remove('open');
  }
  /** 入口按钮点击：面板在展示/隐藏之间切换 */
  function togglePanel() {
    const panel = document.querySelector('#mwiPlcsPanel');
    if (!panel) return;
    if (panel.classList.contains('open')) closePanel();
    else openPanel();
  }

  /**
   * 把入口按钮注入市场面板第一行 tab（视图 tab：商品列表/我的挂牌）末尾。
   * 克隆未选中 tab 的完整样式类（排除 Mui-selected）保证与原生 tab 同规格；
   * 主题覆盖为游戏 success 金橙底色，保持"醒目入口"的辨识度。
   * 游戏切页面/面板重挂载会丢掉该节点，由 watchdog 每 1.5s 补注入。
   */
  function injectTabEntry() {
    if (tabEntry()) return;
    const mp = qCls('MarketplacePanel_marketplacePanel');
    if (!mp) return;
    // 视图 tab 行（商品列表/我的挂牌）是面板内第一个 MuiTabs，tab 数少；分类行（资源/消耗品…）tab 数多
    const flex = Array.from(mp.querySelectorAll('[class*="MuiTabs-flexContainer"]'))
      .find((f) => f.querySelectorAll('[class*="MuiTab-root"]').length < 5) ||
      mp.querySelector('[class*="MuiTabs-flexContainer"]');
    if (!flex) return;
    const ref = Array.from(flex.querySelectorAll('[class*="MuiTab-root"]'))
      .find((t) => !/\bMui-selected\b/.test(t.className)) ||
      flex.querySelector('[class*="MuiTab-root"]');
    if (!ref) return;
    const entry = document.createElement('button');
    entry.type = 'button';
    entry.id = 'mwiPlcsTabEntry';
    entry.className = ref.className.split(' ').filter((c) => !/Mui-selected/.test(c)).join(' ');
    entry.setAttribute('role', 'tab');
    entry.textContent = '🐄 快速出售';
    flex.appendChild(entry);
    entry.addEventListener('click', togglePanel);
  }

  function clampFloatHost() {
    if (!floatHost) return;
    const r = floatHost.getBoundingClientRect();
    const maxX = Math.max(0, window.innerWidth - r.width);
    const maxY = Math.max(0, window.innerHeight - r.height);
    const x = Math.min(Math.max(0, r.left), maxX);
    const y = Math.min(Math.max(0, r.top), maxY);
    if (x !== r.left) floatHost.style.left = x + 'px';
    if (y !== r.top) floatHost.style.top = y + 'px';
  }
  function unloadComponent() {
    if (!floatHost) return;
    running = false; // 掉线时停止批量
    if (floatHost.parentNode) floatHost.parentNode.removeChild(floatHost);
    window.removeEventListener('resize', clampFloatHost);
    window.removeEventListener('orientationchange', clampFloatHost);
    floatHost = null;
    // 市场 tab 里的入口按钮一并移除（重新进入市场后由 watchdog 重新注入）
    const entry = tabEntry();
    if (entry && entry.parentNode) entry.parentNode.removeChild(entry);
    // 注意：不清除 watchdog——它需要继续监听重连，重新进入游戏后自动重建组件
  }
  function watchDisconnect() {
    if (watchdogTimer) return;
    watchdogTimer = setInterval(() => {
      const st = getGameState();
      const disconnected = !!(st && st.isFullDisconnected);
      window.__PLCS_WATCH__ = { floatHost: !!floatHost, timer: !!watchdogTimer, disconnected: disconnected ? 1 : 0, inGame: !!st };
      if (!st) {
        // 不在游戏页面（游戏状态不可用）：回收组件、退出出售状态；重新进入游戏后由下方分支重建
        if (floatHost) unloadComponent();
      } else if (disconnected && floatHost) {
        unloadComponent();
      } else if (!disconnected && !floatHost) {
        buildPanel(); // 重新进入游戏 → 重新挂载
      } else if (floatHost) {
        injectTabEntry(); // 市场 tab 行出现/重挂载时补注入入口按钮
      }
    }, 1500);
  }

  /** 停止/结束后清空进度与队列、弹窗提示行，还原入口文本 */
  function clearBatchUI() {
    const q = document.querySelector('#mwiPlcsQueue');
    const p = document.querySelector('#mwiPlcsProgress');
    const t = tabEntry();
    clearHint();
    if (q) q.innerHTML = '';
    if (p) p.style.display = 'none';
    if (t && t.textContent !== '🐄 快速出售') t.textContent = '🐄 快速出售';
  }

  let panelMsgTimer = null;
  /** 页面级提示：悬浮在页面顶部居中，3 秒自动消失；多次调用重置计时 */
  function showPanelMsg(msg) {
    clearPanelMsg();
    let toast = document.querySelector('#mwiPlcsToast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'mwiPlcsToast';
      document.body.appendChild(toast);
    }
    toast.textContent = msg;
    toast.style.display = 'block';
    panelMsgTimer = setTimeout(clearPanelMsg, 3000);
  }
  function clearPanelMsg() {
    if (panelMsgTimer) { clearTimeout(panelMsgTimer); panelMsgTimer = null; }
    const toast = document.querySelector('#mwiPlcsToast');
    if (toast) {
      toast.style.display = 'none';
      toast.textContent = '';
    }
  }

  function esc(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  function fmt(n) {
    n = Number(n) || 0;
    if (n >= 1e9) return (n / 1e9).toFixed(2) + 'B';
    if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M';
    if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K';
    return String(n);
  }
  /**
   * 游戏 formatShorten 同款：K/M/B/T 缩写，向下取整（非四舍五入），10-99 区间保留一位小数。
   * 与订单簿表格价格列显示完全一致（实机验证：6140000→6140K、1175000→1175K）。
   */
  function fmtShorten(n) {
    n = Number(n) || 0;
    const abs = Math.abs(n);
    const K = 1000, M = 1e6, B = 1e9, T = 1e12;
    let s = n, suffix = '';
    const rounded = Math.round(abs);
    if (rounded < 100 * K) s = n;
    else if (rounded < 10 * M) { s = n / K; suffix = 'K'; }
    else if (rounded < 10 * B) { s = n / M; suffix = 'M'; }
    else if (rounded < 10 * T) { s = n / B; suffix = 'B'; }
    else { s = n / T; suffix = 'T'; }
    s = (s >= 10 && s < 100) ? Math.floor(10 * s) / 10 : Math.floor(s);
    return String(s) + suffix;
  }
  let lastLog = '';
  /** 提示信息：写入出售弹窗底部的提示行（由 injectSellHint 注入）；toConsole=false 时不打印控制台（纯 UI 反馈类日志） */
  function setLog(msg, toConsole) {
    lastLog = msg;
    const el = document.querySelector('#mwiPlcsLog');
    if (el) el.textContent = msg;
    if (toConsole !== false) log(msg);
  }
  /** 清空弹窗提示行（停止/结束后调用，面板上不保留提示） */
  function clearHint() {
    lastLog = '';
    const el = document.querySelector('#mwiPlcsLog');
    if (el) el.textContent = '';
  }
  /** 出售弹窗打开时，在弹窗底部注入提示信息行（显示最近一条日志；弹窗关闭后随游戏卸载） */
  function injectSellHint() {
    const modal = qCls('MarketplacePanel_modalContent');
    if (!modal || modal.querySelector('#mwiPlcsLog')) return;
    const hint = document.createElement('div');
    hint.id = 'mwiPlcsLog';
    // 弹窗是 flex 内容驱动宽度，max-width:100% 会和容器宽度循环依赖导致长文本把弹窗撑宽；
    // 因此注入时读取弹窗当前宽度，写死像素级 max-width —— 内容超宽自动换行、行高自适应
    const modalW = modal.getBoundingClientRect().width;
    hint.style.cssText = 'margin:0.375rem auto 0;max-width:' + Math.max(160, Math.round(modalW)) + 'px;width:100%;box-sizing:border-box;text-align:center;color:#9fb0c8;font-size:0.75rem;line-height:1.35;word-break:break-all;background:#10131a;border:0.0625rem solid #2a2f3b;border-radius:0.25rem;padding:0.25rem 0.375rem;';
    hint.textContent = lastLog;
    modal.appendChild(hint);
  }
  /**
   * 用 MutationObserver 实时监听出售弹窗渲染完成（modalContent + 发布按钮容器均就绪）即触发 cb，
   * 取代固定 waitMs 等待——弹窗一出现就立即注入忽略按钮与提示，不再空等。带超时回退，避免极端情况下卡死。
   * cb 保证只执行一次；root 优先挂市场面板子树，缺失时退到 document.body。
   */
  function whenSellModalReady(cb, timeoutMs) {
    return new Promise((resolve) => {
      let done = false;
      const fire = () => { if (done) return; done = true; try { cb(); } finally { resolve(); } };
      const root = qCls('MarketplacePanel_marketplacePanel') || document.body;
      const ready = () =>
        qCls('MarketplacePanel_modalContent', root) && qCls('MarketplacePanel_postButtonContainer', root);
      if (ready()) { fire(); return; }
      let obs = null;
      try {
        obs = new MutationObserver(() => {
          if (ready()) { if (obs) obs.disconnect(); fire(); }
        });
        obs.observe(root, { childList: true, subtree: true });
      } catch (e) { /* 监听建立失败直接回退到超时 */ }
      setTimeout(() => { if (obs) obs.disconnect(); fire(); }, timeoutMs || 3000);
    });
  }
  function renderQueue(items, idx) {
    const el = document.querySelector('#mwiPlcsQueue');
    if (!el) return;
    // 本次所有物品总价值（预估挂单金额），供进度行右侧展示
    const queueTotal = items.reduce((s, it) => s + (Number(it.total) || 0), 0);
    renderProgress(idx, items.length, queueTotal);
    // 只展示当前项与下一项（共 2 条）
    const show = items.slice(idx, idx + 2);
    if (!show.length) { el.innerHTML = ''; return; }
    // 单行条目：图标 + 名称 + ×数量 + 总价值 挤在一行
    el.innerHTML = show.map((it, k) =>
      '<div class="mwiPlcsItem' + (k === 0 ? ' current' : '') + '">' +
      itemIconSvg(it.itemHrid, 1.3) +
      '<span class="name">' + esc(it.name) + '</span>' +
      '<span class="qty">×' + fmt(it.count) + '</span>' +
      '<span class="total">' + fmt(it.total) + '</span></div>').join('');
  }

  /** 总进度行：左=进度（当前/总数+百分比），右=已屏蔽物品数 + 本次总价；并同步到 tab 入口按钮的文本 */
  function renderProgress(idx, total, queueTotal) {
    const el = document.querySelector('#mwiPlcsProgress');
    const t = tabEntry();
    if (!el) return;
    if (!total) {
      el.style.display = 'none';
      if (t && t.textContent !== '🐄 快速出售') t.textContent = '🐄 快速出售';
      return;
    }
    el.style.display = 'flex';
    const n = Math.min(idx + 1, total);
    const pct = total ? Math.round((n / total) * 100) : 0;
    const left = el.querySelector('.pl');
    const right = el.querySelector('.pr');
    if (left) left.textContent = '进度：' + n + ' / ' + total + '（' + pct + '%）';
    if (right) {
      // 右=已屏蔽数 + 本次全部物品总价（取整到 M 级单位，用 fmt 展示）
      const parts = ['已屏蔽 ' + readIgnored().size];
      const qt = Number(queueTotal) || 0;
      if (qt > 0) parts.push('总价 ' + fmt(qt));
      right.textContent = parts.join(' · ');
    }
    if (t) t.textContent = '🐄 快速出售 (' + n + '/' + total + ')';
  }
  /**
   * 设置区块：出售报价三选一 + 排除规则（食物/饮料开关、单价/总价阈值以 M 为单位、勾选才生效）+ 重置默认。
   * 修改即时写入 localStorage，直接作用于后续批量出售的报价与筛选决策。
   */
  function renderSettings() {
    const root = document.querySelector('#mwiPlcsSettings');
    if (!root) return;
    const cfg = readSettings();
    const opt = (v, label, title) =>
      '<button type="button" class="mwiPlcsBtn' + (cfg.sellOption === v ? ' on' : '') + '" data-sell-opt="' + v + '" title="' + title + '">' + label + '</button>';
    const thresholdRow = (onKey, text, numKey) => {
      const enabled = !!cfg[onKey];
      return '<div class="mwiPlcsCfgRow' + (enabled ? '' : ' off') + '">' +
        '<label><input type="checkbox" data-cfg="' + onKey + '"' + (enabled ? ' checked' : '') + '> ' + text + '</label>' +
        '<input type="number" data-cfg="' + numKey + '" min="0" step="1" value="' + cfg[numKey] + '"' + (enabled ? '' : ' disabled') + '>' +
        '<span class="suffix">M</span></div>';
    };
    const catRow = (key, text) => {
      const on = !!cfg[key];
      return '<div class="mwiPlcsCfgRow' + (on ? '' : ' off') + '">' +
        '<label><input type="checkbox" data-cfg="' + key + '"' + (on ? ' checked' : '') + '> ' + text + '</label></div>';
    };
    root.innerHTML =
      '<div class="sec">出售报价</div>' +
      '<div class="mwiPlcsSellOpt">' +
      opt(SELL_OPTION_DEFAULT, '默认出售报价', '使用游戏默认价格（打开弹窗时的初始值）') +
      opt(SELL_OPTION_BEST_ASK, '最佳出售报价', '使用订单簿左一（最低卖价）') +
      opt(SELL_OPTION_BEST_BID, '最佳购买报价', '使用订单簿右一（最高买价）') +
      '</div>' +
      '<div class="sec">排除规则</div>' +
      '<div id="mwiPlcsCfgRows">' +
      catRow('excludeFood', '排除食物') +
      catRow('excludeDrink', '排除饮料') +
      catRow('skipBelowVendor', '右一扣税后低于商人价不出售') +
      thresholdRow('enableMaxUnitValue', '忽略单价超过', 'maxUnitValue') +
      thresholdRow('enableMinTotalValue', '忽略总价低于', 'minTotalValue') +
      '</div>' +
      '<button type="button" class="mwiPlcsBtn" id="mwiPlcsCfgReset">重置默认</button>';
    root.querySelectorAll('[data-sell-opt]').forEach((b) => {
      b.addEventListener('click', () => {
        saveSettings({ sellOption: b.dataset.sellOpt });
        renderSettings();
        setLog('出售报价已设为「' + b.textContent.trim() + '」', false);
      });
    });
    root.querySelectorAll('[data-cfg]').forEach((el) => {
      el.addEventListener('change', () => {
        if (el.type === 'checkbox') saveSettings({ [el.dataset.cfg]: el.checked });
        else saveSettings({ [el.dataset.cfg]: Number(el.value) || 0 });
        renderSettings();
        setLog('排除规则已更新', false);
      });
    });
    root.querySelector('#mwiPlcsCfgReset').addEventListener('click', () => {
      writeStore({ settings: Object.assign({}, DEFAULT_SETTINGS) });
      renderSettings();
      setLog('已恢复默认设置', false);
    });
  }

  /** 已屏蔽列表：面板内直接展示（图标 + 本地化名称 + 解锁 + 标题行清空按钮） */
  function renderIgnoreList() {
    const listEl = document.querySelector('#mwiPlcsIgnoreList');
    if (!listEl) return;
    const set = readIgnored();
    if (!set.size) {
      listEl.innerHTML = '<div class="mwiPlcsIgnoreHead">已屏蔽物品 (0) —— 出售弹窗里点「忽略该物品」可添加</div>';
      return;
    }
    const rows = [...set].map((hrid) =>
      '<div class="mwiPlcsIgnoreRow">' + itemIconSvg(hrid, 1.4) +
      '<span class="mwiPlcsIgnoreName" title="' + esc(hrid) + '">' + esc(localizedName(hrid)) + '</span>' +
      '<button class="mwiPlcsBtn small" data-unignore="' + esc(hrid) + '">解锁</button></div>').join('');
    // 标题行：左=已屏蔽物品 (N)，右=清空按钮（一键清空全部）
    listEl.innerHTML =
      '<div class="mwiPlcsIgnoreHead"><span>已屏蔽物品 (' + set.size + ')</span>' +
      '<button type="button" class="mwiPlcsBtn small danger" id="mwiPlcsIgnoreClear">清空</button></div>' +
      rows;
    listEl.querySelectorAll('[data-unignore]').forEach((b) => {
      b.addEventListener('click', () => { removeIgnored(b.dataset.unignore); renderIgnoreList(); setLog('已解锁，下次批量将重新包含该物品', false); });
    });
    const clearBtn = listEl.querySelector('#mwiPlcsIgnoreClear');
    if (clearBtn) {
      clearBtn.addEventListener('click', () => { clearIgnored(); renderIgnoreList(); setLog('已清空全部屏蔽物品', false); });
    }
  }

  // ============================================================
  // 批量出售流程
  // ============================================================

  let running = false;

  /** 让市场面板可见。
   * 使用游戏宿主的直接导航方法 handleChangeNavTarget('marketplace')（与点导航按钮等价）；
   * 不要用 handleGoToMarketplace（它走弹窗直通模式，会挂在不显示的侧栏里导致"卡住"），
   * 也不要模拟点击导航（菜单折叠时点不到）。 */
  async function ensureMarketOpen() {
    const visible = () => {
      const el = qCls('MarketplacePanel_marketplacePanel');
      return !!el && el.getClientRects().length > 0;
    };
    if (visible()) return true;
    const host = getGameHost();
    if (!host || typeof host.handleChangeNavTarget !== 'function') return false;
    host.handleChangeNavTarget('marketplace');
    return !!(await waitFor(visible, 5000));
  }

  /**
   * 挂单额度检查：挂单满 → 切「我的挂牌」等用户收集
   * 收集出空位 → true；超时仍满 → false（结束批量）
   */
  async function ensureListingSlots() {
    const st = getGameState();
    if (!st) return false;
    const cap = Number(st.characterInfo && st.characterInfo.marketListingCap) || 0;
    const used = st.myMarketListingMap ? st.myMarketListingMap.size : 0;
    if (used < cap) return true;

    setLog('挂牌已满 (' + used + '/' + cap + ')，已切到「我的挂牌」，请收集已完成/到期的挂单…');
    const panel = qCls('MarketplacePanel_marketplacePanel');
    if (panel) {
      const tab = Array.from(panel.querySelectorAll('button')).find((b) => /我的挂牌|my listings/i.test(b.textContent || ''));
      if (tab) tab.click();
    }
    const deadline = Date.now() + 3 * 60 * 1000;
    while (Date.now() < deadline) {
      if (running === false) throw new Error('已停止');
      const s2 = getGameState();
      const used2 = s2 && s2.myMarketListingMap ? s2.myMarketListingMap.size : 0;
      if (used2 < cap) {
        setLog('已收集出可用挂牌位 (' + used2 + '/' + cap + ')，继续批量出售');
        return true;
      }
      await waitMs(2500);
    }
    setLog('❌ 等待收集超时，挂牌位仍满（' + used + '/' + cap + '），批量出售结束，可在「我的挂牌」收集后重试');
    return false;
  }

  /**
   * 单个物品：用游戏宿主导航直达该物品的市场视图（PGE 同款调用 handleGoToMarketplace(itemHrid, level)）
   * → 等摘要出现「+ 新出售挂牌」→ 开弹窗 → 填最佳报价/最大数量
   */
  async function setupItemForm(item) {
    const panel = qCls('MarketplacePanel_marketplacePanel');
    if (!panel) throw new Error('市场面板不可用');

    // 1. 宿主导航到该物品（内部会发起订单簿请求；空参调用会卡在"正在加载"，
    //    必须带 itemHrid 和强化等级 0）
    const host = getGameHost();
    if (!host || typeof host.handleGoToMarketplace !== 'function') throw new Error('无法获取游戏宿主导航方法');
    host.handleGoToMarketplace(item.itemHrid, 0);

    // 2. 等物品摘要视图加载出「+ 新出售挂牌」（需订单簿 WS 数据）。
    //    容错：首次超时 → 重新导航（处理首次调用被竞态吞掉/未生效）→ 再超时 → 点「刷新」→ 最后才报错跳过
    let sellBtn = null;
    const findSellBtn = () => {
      const b = panel.querySelector('[class*="newSellListingButton"]');
      if (b) return b;
      return Array.from(panel.querySelectorAll('button')).find((x) => /新出售挂牌|new sell listing/i.test(x.textContent || ''));
    };
    sellBtn = await waitFor(findSellBtn, 15000);
    if (!sellBtn) {
      setLog('摘要加载慢，重新导航一次…');
      host.handleGoToMarketplace(item.itemHrid, 0);
      sellBtn = await waitFor(findSellBtn, 15000);
    }
    if (!sellBtn) {
      const refresh = Array.from(panel.querySelectorAll('button')).find((b) => /^刷新$|^Refresh$/.test(b.textContent.trim()));
      if (refresh) { refresh.click(); setLog('订单簿加载慢，已点「刷新」，继续等待…'); }
      sellBtn = await waitFor(findSellBtn, 15000);
      if (!sellBtn) throw new Error('「+ 新出售挂牌」按钮超时未出现');
    }

    // 3. 点击「+ 新出售挂牌」打开弹窗
    sellBtn.click();
    if (!(await waitFor(() => qCls('MarketplacePanel_modalContent', panel), 8000))) {
      throw new Error('出售弹窗未打开');
    }
    // 用 MutationObserver 监听弹窗（modalContent + 发布按钮容器）就绪即注入忽略按钮、左一/右一行与提示，避免空等
    await whenSellModalReady(() => {
      injectIgnoreButton();
      injectOrderBookLine();
      // 弹窗打开即展示正确提示：等待用户确认价格/数量后发布
      setLog('等待确认：检查价格/数量后点「发布出售挂牌」，或点「忽略该物品」/关闭弹窗完成本项', false);
      injectSellHint();
    });

    // 4. 保护规则：右一价扣税后低于商人价 → 本项不出售（直接跳过，不填价）
    const cfg = readSettings();
    if (cfg.skipBelowVendor) {
      const inst = getMarketInst();
      const { bid } = readOrderBookLevel0(inst);
      const vendor = vendorPriceOf(item.itemHrid);
      const tax = taxRateOf(item.itemHrid);
      if (bid && bid.price > 0 && vendor > 0) {
        const net = bid.price * (1 - tax);
        if (net < vendor) {
          setLog('右一 ' + fmtShorten(bid.price) + ' 扣税后 ' + fmtShorten(Math.round(net)) + ' 低于商人价 ' + fmtShorten(vendor) + '，跳过本项', false);
          closeModal();
          return 'skip'; // 主循环识别后进入下一项
        }
      }
    }

    // 5. 按设置决定报价：默认出售报价（不干预）/ 最佳出售报价（左一）/ 最佳购买报价（右一）
    if (cfg.sellOption === SELL_OPTION_BEST_ASK || cfg.sellOption === SELL_OPTION_BEST_BID) {
      const inst = getMarketInst();
      const { ask, bid } = readOrderBookLevel0(inst);
      const target = cfg.sellOption === SELL_OPTION_BEST_ASK ? ask : bid;
      if (target && target.price > 0 && inst && typeof inst.handleSetPriceInput === 'function') {
        inst.handleSetPriceInput(target.price);
        await waitMs(300);
        setLog('已填入' + (cfg.sellOption === SELL_OPTION_BEST_ASK ? '最佳出售报价（左一）' : '最佳购买报价（右一）') + '，请确认', false);
      } else {
        setLog('暂无' + (cfg.sellOption === SELL_OPTION_BEST_ASK ? '最佳出售报价' : '最佳购买报价') + '，保持默认价格，请留意', false);
      }
    }

    // 6. 点「最多」填满数量
    const maxBtn = Array.from(panel.querySelectorAll('button')).find((b) => /^最多$|^Max$|^All$/.test(b.textContent.trim()));
    if (maxBtn) {
      maxBtn.click();
      await waitMs(300);
    }
    return true;
  }

  /** 出售弹窗内：把「忽略该物品」放在发布按钮的左侧（两者并排一行；容器本身是块级布局，需包一层横向 flex 行）。
   * 尺寸与发布按钮一致（克隆其 CSS 类）；颜色从游戏源码/页面取主色变体（Button_primary 蓝紫，"升级容量/链接"按钮同款），
   * 避免与"发布出售挂牌"（success 金色）视觉混淆 */
  function injectIgnoreButton() {
    const cont = qCls('MarketplacePanel_postButtonContainer');
    if (!cont || cont.querySelector('.mwiPlcsIgnoreBtn')) return;
    const sellBtn = cont.querySelector('button');
    if (!sellBtn) return;
    const btn = document.createElement('button');
    btn.type = 'button';
    let cls = typeof sellBtn.className === 'string' ? sellBtn.className : '';
    // 用游戏 primary 变体替换 success 变体（颜色来自游戏自身按钮体系）；
    // primary 取不到时回退 warning（取消）色，保证与发布按钮（success 金）颜色始终不同
    let pCls = null;
    const primaryEl = document.querySelector('[class*="Button_primary"]');
    if (primaryEl && typeof primaryEl.className === 'string') {
      pCls = primaryEl.className.split(' ').find((c) => /Button_primary/.test(c)) || null;
    }
    if (!pCls) {
      const warnEl = document.querySelector('[class*="Button_warning"]');
      if (warnEl && typeof warnEl.className === 'string') {
        pCls = warnEl.className.split(' ').find((c) => /Button_warning/.test(c)) || null;
      }
    }
    if (pCls && typeof cls === 'string') {
      cls = cls.split(' ').map((c) => (/success/i.test(c) ? pCls : c)).join(' ');
    }
    btn.className = ('mwiPlcsIgnoreBtn ' + cls).trim();
    btn.textContent = '忽略该物品';
    // 行容器：忽略按钮在左、发布按钮在右（间距用 rem，与游戏字号体系一致）
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;align-items:center;justify-content:center;gap:0.375rem;';
    sellBtn.parentNode.insertBefore(row, sellBtn);
    row.appendChild(btn);
    row.appendChild(sellBtn);
    btn.addEventListener('click', () => {
      const inst = getMarketInst();
      const itemHrid = inst && inst.state && inst.state.itemHrid;
      if (!itemHrid) { setLog('忽略失败：未识别当前物品', false); return; }
      addIgnored(itemHrid);
      setLog('已屏蔽「' + itemHrid.split('/').pop() + '」，本次跳过；可在面板「已屏蔽」中解锁', false);
      renderIgnoreList();
      if (inst && typeof inst.handleHidePostListing === 'function') inst.handleHidePostListing();
    });
  }

  /** 出售弹窗价格行下方注入一行：左（最低卖价+数量）/ 右（最高买价+数量），中间为 x 档，价格可点击填入价格框 */
  function injectOrderBookLine() {
    const modal = qCls('MarketplacePanel_modalContent');
    if (!modal || modal.querySelector('#mwiPlcsOrderLine')) return;
    const inst = getMarketInst();
    const { ask, bid } = readOrderBookLevel0(inst);
    const parts = [];
    if (ask) {
      parts.push('<span class="qtyc">(x' + fmtShorten(ask.quantity) + ')</span> <span class="ob ask" data-price="' + ask.price + '">左 ' + fmtShorten(ask.price) + '</span>');
    }
    if (ask && bid) {
      const d = diffBins(ask.price, bid.price);
      if (d !== null) parts.push('<span class="obDiff">' + d + ' 档</span>');
    }
    if (bid) {
      parts.push('<span class="ob bid" data-price="' + bid.price + '">右 ' + fmtShorten(bid.price) + '</span><span class="qtyc"> (x' + fmtShorten(bid.quantity) + ')</span>');
    }
    if (!parts.length) parts.push('暂无订单簿数据');
    const line = document.createElement('div');
    line.id = 'mwiPlcsOrderLine';
    line.style.cssText = 'margin:0.375rem auto 0;max-width:100%;box-sizing:border-box;text-align:center;color:#9fb0c8;font-size:0.875rem;line-height:1.35;background:#10131a;border:0.0625rem solid #2a2f3b;border-radius:0.25rem;padding:0.25rem 0.375rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;';
    line.innerHTML = parts.join('  /  ');
    // 数量部分点击不触发填价（与整块点击区分）
    line.querySelectorAll('.qtyc').forEach((q) => {
      q.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); });
    });
    // 点击左一/右一（标签+价格整块）→ 填入上方价格框（与「最佳出售报价」点击等价）
    line.querySelectorAll('.ob[data-price]').forEach((ob) => {
      ob.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const target = Number(ob.dataset.price);
        if (!(target > 0)) return;
        const m = getMarketInst();
        if (m && typeof m.handleSetPriceInput === 'function') {
          m.handleSetPriceInput(target);
          setLog('已填入价格 ' + fmtShorten(target) + '，请确认', false);
        }
      });
    });
    // 挂在价格输入区（priceInputs）之后，即价格行正下方
    const priceInputs = qCls('MarketplacePanel_priceInputs', modal);
    if (priceInputs && priceInputs.parentNode) {
      priceInputs.parentNode.insertBefore(line, priceInputs.nextSibling);
    } else {
      modal.appendChild(line);
    }
  }

  /** 等待用户完成出售（弹窗关闭即下一步） */
  async function waitForModalClose() {
    const panel = qCls('MarketplacePanel_marketplacePanel');
    if (!panel) return;
    const start = Date.now();
    while (Date.now() - start < 30 * 60 * 1000) {
      if (running === false) throw new Error('已停止');
      if (!qCls('MarketplacePanel_modalContent', panel)) return;
      await waitMs(300);
    }
  }

  /** 主流程 */
  async function startBatch() {
    if (running) return;
    running = true;
    clearPanelMsg(); // 每次开始先清掉上一次的面板提示（如空数据提示）
    const stopBtn = document.querySelector('#mwiPlcsStop');
    const startBtn = document.querySelector('#mwiPlcsStart');
    if (stopBtn) stopBtn.style.display = 'inline-block';
    if (startBtn) startBtn.style.display = 'none';
    // 出售中：面板自动吸附回左下角（无论此前拖到哪），高度由内容决定（CSS height:auto + max-height 上限）
    if (floatHost) {
      const rootFs = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
      const gap = (window.innerWidth <= 45 * rootFs ? 0.375 : 0.75) * rootFs;
      floatHost.style.left = gap + 'px';
      floatHost.style.top = 'auto';
      floatHost.style.bottom = gap + 'px';
    }
    // 开始出售时不展示已屏蔽列表与设置区块（面板保持现有紧凑高度，停止后恢复）
    const ignoreList = document.querySelector('#mwiPlcsIgnoreList');
    if (ignoreList) ignoreList.style.display = 'none';
    const settingsEl = document.querySelector('#mwiPlcsSettings');
    if (settingsEl) settingsEl.style.display = 'none';

    try {
      if (!(await ensureMarketOpen())) throw new Error('无法打开市场面板');
      // 市场面板打开后再读库存，确保可交易清单（marketItems）已就绪
      const items = readSellableItems();
      if (!items.length) {
        setLog('没有可出售的库存物品（已排除不可交易 / 强化>0 / 命中排除规则 / 已屏蔽）');
        showPanelMsg('没有符合条件的数据：已排除不可交易 / 强化>0 / 命中排除规则 / 已屏蔽的物品，请调整设置或检查库存');
        return;
      }
      setLog('共 ' + items.length + ' 个物品可出售，按总价值从高到低开始…');

      if (!(await ensureListingSlots())) return;

      for (let i = 0; i < items.length && running; i++) {
        const item = items[i];
        renderQueue(items, i);
        try {
          const r = await setupItemForm(item);
          // 保护规则跳过（弹窗已关闭）→ 直接进入下一项，不再等弹窗关闭
          if (r !== 'skip') await waitForModalClose();
        } catch (e) {
          if (e.message === '已停止') break;
          setLog('⚠️ 处理失败：' + e.message + '（已跳过）');
          try { closeModal(); } catch (err) { /* ignore */ }
          await waitMs(1200);
        }
        if (running && !(await ensureListingSlots())) break;
      }
      if (running) setLog('✅ 批量出售完成');
    } catch (e) {
      if (e.message !== '已停止') setLog('❌ 批量出售中止：' + e.message);
    } finally {
      running = false;
      if (stopBtn) stopBtn.style.display = 'none';
      if (startBtn) startBtn.style.display = 'inline-block';
      // 停止/结束后清空进度与队列，恢复已屏蔽列表与设置区块
      clearBatchUI();
      if (ignoreList) { ignoreList.style.display = ''; renderIgnoreList(); }
      if (settingsEl) { settingsEl.style.display = ''; renderSettings(); }
    }
  }

  function closeModal() {
    const inst = getMarketInst();
    if (inst && typeof inst.handleHidePostListing === 'function') inst.handleHidePostListing();
  }

  // ============================================================
  // 启动：等游戏主界面就绪后挂面板
  // ============================================================

  const bootTimer = setInterval(() => {
    if (document.querySelector('#root') && rootFiber() && getGameState()) {
      clearInterval(bootTimer);
      buildPanel();
    }
  }, 800);
})();