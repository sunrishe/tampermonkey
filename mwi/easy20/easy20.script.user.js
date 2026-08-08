// ==UserScript==
// @name               [银河奶牛]装备强化轻松+20（测试服专用）
// @name:zh-CN         [银河奶牛]装备强化轻松+20（测试服专用）
// @name:en            MWI Easy Equipment Enhance +20 (Test Server)
// @version            2.5.0
// @namespace          http://tampermonkey.net/
// @description        通过自由强化、批量强化基底、批量合成功能轻松完成物品的强化😀
// @description:zh-CN  通过自由强化、批量强化基底、批量合成功能轻松完成物品的强化😀
// @description:en     Easily enhance equipment with custom enhancing, batch base enhancing, and batch merge features.
// @author             sunrishe
// @website            https://greasyfork.org/zh-CN/scripts/567954
// @website            https://gf.qytechs.cn/zh-CN/scripts/567954
// @match              https://test.milkywayidle.com/*
// @match              https://test.milkywayidlecn.com/*
// @icon               https://www.google.com/s2/favicons?sz=64&domain=milkywayidle.com
// @grant              GM_addStyle
// @require            https://cdn.jsdelivr.net/npm/sweetalert2@11
// @run-at             document-body
// @license            MIT
// @reference          脚本设计思路参考 https://greasyfork.org/zh-CN/scripts/560117
// @reference          部分工具方法参考 https://greasyfork.org/zh-CN/scripts/538797
// @homepage           https://github.com/sunrishe/tampermonkey/tree/master/mwi/easy20
// @downloadURL        https://update.greasyfork.org/scripts/567954/%5B%E9%93%B6%E6%B2%B3%E5%A5%B6%E7%89%9B%5D%E8%A3%85%E5%A4%87%E5%BC%BA%E5%8C%96%E8%BD%BB%E6%9D%BE%2B20%EF%BC%88%E6%B5%8B%E8%AF%95%E6%9C%8D%E4%B8%93%E7%94%A8%EF%BC%89.user.js
// @updateURL          https://update.greasyfork.org/scripts/567954/%5B%E9%93%B6%E6%B2%B3%E5%A5%B6%E7%89%9B%5D%E8%A3%85%E5%A4%87%E5%BC%BA%E5%8C%96%E8%BD%BB%E6%9D%BE%2B20%EF%BC%88%E6%B5%8B%E8%AF%95%E6%9C%8D%E4%B8%93%E7%94%A8%EF%BC%89.meta.js
// ==/UserScript==

(function () {
    'use strict';
    const urlParams = new URLSearchParams(window.location.search);
    const characterId = urlParams.get('characterId');
    let ws = null;

    // 允许修改的参数
    const isDebug = false;
    const retry = 3; // 添加队列时失败最大重试次数
    const wsReceiveTimeout = 120 * 1000; // 添加队列时等待回执的超时时间
    const reqSpamProtecTimeout = 3000; // 触发过快发送游戏指令的等待时间
    const addQueueSleepMinTime = 800; // 添加队列成功后的最小等待时间
    const addQueueSleepMaxTime = 1200; // 添加队列成功后的最大等待时间

    const i18n = {
        currentLang: 'en',
        messages: {
            confirm: {zh: '确认', en: 'Confirm'},
            deny: {zh: '拒绝', en: 'Deny'},
            cancel: {zh: '取消', en: 'Cancel'},
            minute: {zh: '{0}分钟', en: '{0} min'},
            second: {zh: '{0}秒', en: '{0} sec'},
            freedom: {zh: '自由强化', en: 'Custom Enhancing'},
            enhanceBaseBtn: {zh: '批量强化+{0}基底', en: 'Batch Enhance +{0} Bases'},
            mergeBtn: {zh: '批量合成+{0}', en: 'Batch Merge to +{0}'},
            stopTask: {zh: '停止任务', en: 'Stop Task'},
            baseLabel: {zh: '+{0}基底', en: '+{0} Bases'},
            mergeLabel: {zh: '+{0}合成', en: 'Merge to +{0}'},
            wsNotConnected: {zh: 'WebSocket 未连接，无法发送消息', en: 'WebSocket is not connected.'},
            sendUnexpectedError: {zh: '消息发送失败: 发生意外错误', en: 'Failed to send message: unexpected error.'},
            sendSpamProtection: {zh: '消息发送失败: 请勿过快发送游戏指令', en: 'Failed to send message: please do not send game commands too quickly.'},
            sendFailed: {zh: '消息发送失败: {0}', en: 'Failed to send message: {0}'},
            sendTimeout: {zh: '消息发送超时，已等待{0}', en: 'Message send timed out after {0}.'},
            userAbort: {zh: '用户中止任务', en: 'Task stopped by user.'},
            taskBatchEnhanceBase: {zh: '批量强化基底', en: 'Batch Enhance Bases'},
            taskBatchMerge: {zh: '批量合成+{0}', en: 'Batch Merge to +{0}'},
            taskStopping: {zh: '⚠️ 批量任务停止中，请稍等', en: '⚠️ Task is stopping. Please wait.'},
            taskRunning: {zh: '⚠️ {0}任务执行中，请等待执行完成后再试', en: '⚠️ {0} is running. Please wait until it finishes.'},
            checkWsNotConnected: {
                zh: '❌ WebSocket 未连接！请先手动点一次强化操作再试',
                en: '❌ WebSocket is not connected. Please manually start one enhancing action first.',
            },
            itemInfoMissing: {zh: '❌ 未获取到物品信息！请确认已选择物品', en: '❌ Item info was not found. Please select an item.'},
            normalEnhance: {zh: '普通强化', en: 'normal enhancing'},
            philosopherMerge: {zh: '贤者之镜合成', en: "Philosopher's Mirror merge"},
            repeatTimes: {zh: '重复{0}次', en: ', repeat {0} times'},
            auto: {zh: '自动', en: 'auto'},
            taskCount: {zh: '{0}个任务', en: '{0} tasks'},
            freedomTips: {
                zh:
                    '1. 【极其重要】强化等级对应的物品必须存在，否则发起任务无响应页面假死，可以点击停止任务中止；\n' +
                    '2. 【重要】不会检测库存，添加任务时请确保基础物品及强化资源足够，否则强化任务会提前结束；\n' +
                    '3. 保护之镜强化会读取页面选择的配装方案，贤者之镜强化则使用无配装；\n' +
                    '4. 使用页面选择的保护物品，请确保物品数量充足；\n' +
                    '5. 不建议使用福气茶，会出现预估外的物品；\n' +
                    '6. 不建议添加过多队列，否则等待时间会很长。',
                en:
                    '1. [Critical] The item at the selected enhancement level must exist, otherwise the queued action may not respond. Click Stop Task to stop it.\n' +
                    '2. [Important] Inventory is not checked. Make sure base items and enhancing materials are enough, otherwise the enhancing action may end early.\n' +
                    '3. Mirror Of Protection enhancing uses the selected Loadout. Philosopher\'s Mirror merge uses No Loadout.\n' +
                    '4. Make sure you have enough selected protection items.\n' +
                    '5. Blessed Tea is not recommended because it may create unexpected items.\n' +
                    '6. Avoid adding too many Queued Actions, or waiting may take a long time.',
            },
            freedomUseInfo: {
                zh:
                    '[贤者之镜][[起始等级1~]起始等级2-]目标等级[:重复次数]:任务数量\n' +
                    '[]的内容表示可省略，会取该项对应的默认值；贤者之镜用+表示；任务数量支持数字或@自动获取库存\n' +
                    '使用保护之镜强化0到m共300个任务输入m:300\n' +
                    '使用保护之镜强化n到m共300个任务输入n-m:300\n' +
                    '使用保护之镜强化n到m重复100次共300个任务输入n-m:100:300\n' +
                    '使用贤者之镜合成n到m共300个任务输入+n-m:300\n' +
                    '请输入自由强化信息，多个任务用逗号隔开',
                en:
                    '[Philosopher\'s Mirror][[Start Level 1~]Start Level 2-]Target Level[:Repeat]:Task Count\n' +
                    'Parts in [] are optional and use defaults. Prefix with + to use Philosopher\'s Mirror. Task count supports a number or @ for auto inventory count.\n' +
                    'Mirror Of Protection from 0 to m, 300 tasks: m:300\n' +
                    'Mirror Of Protection from n to m, 300 tasks: n-m:300\n' +
                    'Mirror Of Protection from n to m, repeat 100 times, 300 tasks: n-m:100:300\n' +
                    'Philosopher\'s Mirror from n to m, 300 tasks: +n-m:300\n' +
                    'Enter custom enhancing rules. Separate multiple rules with commas.',
            },
            freedomTipTitle: {zh: '自由强化提示', en: 'Custom Enhancing Tips'},
            freedomParseTitle: {zh: '自由强化解析结果', en: 'Custom Enhancing Parse Result'},
            freedomParseFailed: {zh: '❌ 第{0}轮，无法解析{1}', en: '❌ Round {0}: cannot parse {1}'},
            freedomParseLine: {
                zh: '第{0}轮，{1}{2}+{3}到+{4}{5}共{6}',
                en: 'Round {0}: {1} {2}+{3} to +{4}{5}, {6}',
            },
            freedomInfo: {zh: '第{0}轮，{1}{2}+{3}到+{4}', en: 'Round {0}: {1} {2}+{3} to +{4}'},
            freedomAbort: {
                zh: '🚫 自由强化中止！\n共发起 {0} 轮 {1} 次{2}强化任务，耗时{3}',
                en: '🚫 Custom enhancing stopped.\nStarted {0} rounds and {1} {2} actions. Time: {3}',
            },
            freedomToastSuccess: {zh: '♻️ 自由强化，{0}: {1}/{2}任务执行成功', en: '♻️ Custom enhancing, {0}: task {1}/{2} succeeded.'},
            freedomToastRetry: {
                zh: '⚠️ 自由强化，{0}: {1}/{2}任务执行失败，重试第{3}次。{4}',
                en: '⚠️ Custom enhancing, {0}: task {1}/{2} failed. Retry {3}. {4}',
            },
            freedomSuccess: {
                zh: '✅ 自由强化完成！\n共发起 {0} 轮 {1} 次{2}强化任务，耗时{3}',
                en: '✅ Custom enhancing completed.\nStarted {0} rounds and {1} {2} actions. Time: {3}',
            },
            freedomError: {zh: '❌ 自由强化任务出现异常，耗时{0}。{1}', en: '❌ Custom enhancing failed after {0}. {1}'},
            lack: {zh: '缺{0}', en: ', missing {0}'},
            extra: {zh: '多{0}', en: ', extra {0}'},
            needEnhanceBase: {zh: '需强化{0}个底子', en: 'Need {0} base enhancing actions'},
            mergeBaseEnough: {zh: '恭喜，合成+{0}底子已足够', en: 'Enough bases to merge to +{0}'},
            needPhilosophersMirror: {zh: '需要{0}个贤者之镜', en: 'Need {0} Philosopher\'s Mirrors'},
            needMergeTasks: {zh: '需执行{0}次合成任务', en: 'Need {0} merge tasks'},
            waitBaseEnhance: {zh: '等待基底强化...', en: 'Waiting for base enhancing...'},
            mergeItemLack: {zh: '合成+{0}物品不足', en: 'Not enough items to merge to +{0}'},
            safeLimitExceeded: {
                zh: '❌ 当前选择 ({0},{1}) 目标+{2}需要 {3} 次强化，超过安全上限 5000 次！\n建议选择更高等级对（如 (15,16) 以上）。',
                en: '❌ Current pair ({0},{1}) to target +{2} needs {3} enhancing actions, exceeding the safety limit of 5000.\nChoose a higher pair, such as (15,16) or above.',
            },
            zeroEnhanceCount: {zh: '❌ 计算待强化次数为0，请检查选择', en: '❌ Calculated enhancing action count is 0. Please check the selection.'},
            missingBaseItems: {zh: '❌ 还缺少{0} {1}个', en: '❌ Missing {1} {0}'},
            baseEnhanceDone: {zh: '✅ 恭喜，基底强化完成', en: '✅ Base enhancing completed.'},
            enhanceTips: {
                zh:
                    '1. 【重要】请准备充足的强化材料，否则强化任务会提前结束，后续强化队列清空；\n' +
                    '2. 自动检测库存中物品是否充足，不足时会给出提示，不会检测已经装备的物品；\n' +
                    '3. 计算强化队列会减掉库存内高于基底等级的物品数量；\n' +
                    '4. 添加基底强化任务会使用页面选择的配装方案；\n' +
                    '5. 使用页面选择的保护物品，请确保物品数量充足；\n' +
                    '6. 不会检测任务队列，使用插件前建议先清空任务队列，否则会合成超过所需数量的物品；\n' +
                    '7. 不建议使用福气茶，会出现预估外的物品；\n' +
                    '8. 不要选择精炼物品进行强化，因为精炼物品强化需要普通物品升级，可以通过【炼金-解精炼】去掉精炼。',
                en:
                    '1. [Important] Prepare enough enhancing materials, otherwise the action may end early and later Queued Actions may be cleared.\n' +
                    '2. Inventory items are checked automatically. Equipped items are not checked.\n' +
                    '3. The queue calculation subtracts inventory items higher than the base level.\n' +
                    '4. Base enhancing actions use the selected Loadout.\n' +
                    '5. Make sure you have enough selected protection items.\n' +
                    '6. The Action Queue is not checked. Clear it before using this script to avoid creating extra items.\n' +
                    '7. Blessed Tea is not recommended because it may create unexpected items.\n' +
                    '8. Do not select refined items. Enhancing refined items requires normal items. Use Alchemy - Unrefine first.',
            },
            enhanceAbort: {
                zh: '🚫 批量强化基底中止！\n使用 ({0}, {1}) 目标+{2}，共发起 {3} 次{4}强化任务，耗时{5}',
                en: '🚫 Batch enhance bases stopped.\nUsing ({0}, {1}) to target +{2}, started {3} {4} enhancing actions. Time: {5}',
            },
            enhanceToastSuccess: {
                zh: '♻️ 批量强化基底，{0}+{1}: {2}/{3}任务执行成功',
                en: '♻️ Batch enhance bases, {0}+{1}: task {2}/{3} succeeded.',
            },
            enhanceToastRetry: {
                zh: '⚠️ 批量强化基底，{0}+{1}: {2}/{3}任务执行失败，重试第{4}次。{5}',
                en: '⚠️ Batch enhance bases, {0}+{1}: task {2}/{3} failed. Retry {4}. {5}',
            },
            enhanceSuccess: {
                zh: '✅ 批量强化基底完成！\n使用 ({0}, {1}) 目标+{2}，共发起 {3} 次{4}强化任务，耗时{5}',
                en: '✅ Batch enhance bases completed.\nUsing ({0}, {1}) to target +{2}, started {3} {4} enhancing actions. Time: {5}',
            },
            enhanceError: {zh: '❌ 执行基底强化任务出现异常，耗时{0}。{1}', en: '❌ Batch enhance bases failed after {0}. {1}'},
            mergeTips: {
                zh:
                    '1. 【重要】请准备充足的贤者之镜；\n' +
                    '2. 贤者之镜强化使用无配装，因为配装方案的自动使用高等级和福气茶可能导致合成失败；\n' +
                    '3. 不要选择精炼物品进行合成；\n' +
                    '4. 不要使用福气茶，会出现预估外的物品，导致合成失败；\n' +
                    '5. 合成队列添加失败可以等待现有队列执行完成后，再次点击合成按钮，会根据已有物品重新计算合成队列。',
                en:
                    '1. [Important] Prepare enough Philosopher\'s Mirrors.\n' +
                    '2. Philosopher\'s Mirror enhancing uses No Loadout because auto higher-level items and Blessed Tea in Loadouts may cause merge failure.\n' +
                    '3. Do not select refined items for merge.\n' +
                    '4. Do not use Blessed Tea, because unexpected items may cause merge failure.\n' +
                    '5. If adding the merge queue fails, wait for the current Queued Actions to finish and click merge again. The queue will be recalculated from current items.',
            },
            mergeTipTitle: {zh: '批量合成+{0}提示', en: 'Batch Merge to +{0} Tips'},
            mergeAbort: {
                zh: '🚫 批量合成+{0}中止！\n共发起 {1} 次{2}强化任务，耗时{3}',
                en: '🚫 Batch merge to +{0} stopped.\nStarted {1} {2} enhancing actions. Time: {3}',
            },
            mergeToastSuccess: {
                zh: '♻️ 批量合成+{0}，{1}{2}/{3}任务执行成功，{4}→{5}',
                en: '♻️ Batch merge to +{0}, {1} task {2}/{3} succeeded, {4}->{5}.',
            },
            mergeToastRetry: {
                zh: '⚠️ 批量合成+{0}，{1}{2}/{3}任务执行失败，{4}→{5}，重试第{6}次。{7}',
                en: '⚠️ Batch merge to +{0}, {1} task {2}/{3} failed, {4}->{5}. Retry {6}. {7}',
            },
            mergeSuccess: {
                zh: '✅ 批量合成+{0}任务完成！\n共发起 {1} 次{2}强化任务，耗时{3}',
                en: '✅ Batch merge to +{0} completed.\nStarted {1} {2} enhancing actions. Time: {3}',
            },
            mergeError: {zh: '❌ 执行批量合成+{0}任务出现异常，耗时{1}。{2}', en: '❌ Batch merge to +{0} failed after {1}. {2}'},
            mergeCheckFailed: {
                zh: '❌ 执行批量合成+{0}任务失败，请检查物品数量是否充足',
                en: '❌ Batch merge to +{0} failed. Please check whether item counts are enough.',
            },
            scriptLoaded: {zh: '🎯 [银河奶牛]装备强化轻松+20（测试服专用）脚本已加载', en: '🎯 MWI Easy +20 script loaded.'},
        },
        loadLangPref() {
            try {
                const gameLang = localStorage.getItem('i18nextLng') || '';
                this.currentLang = gameLang.toLowerCase().startsWith('zh') ? 'zh' : 'en';
            } catch {
                this.currentLang = 'en';
            }
        },
        t(key, ...args) {
            const entry = this.messages[key];
            if (!entry) return key;
            let text = entry[this.currentLang] || entry.zh || key;
            args.forEach((arg, index) => {
                text = text.replaceAll(`{${index}}`, String(arg ?? ''));
            });
            return text;
        },
    };
    i18n.loadLangPref();

    // 引入SweetAlert2自定义样式
    GM_addStyle(`
        .diy-swal2-container .swal2-popup {
            border: 1px solid #d0d0d0;
            border-radius: 0.25rem;
            box-shadow: 0 0 4px 4px hsla(0, 0%, 81.6%, 0.28);
            padding: 0.5rem;
            width: 25rem;
        }

        .diy-swal2-container .swal2-toast {
            padding: 0.25rem 0.5rem;
        }

        .diy-swal2-container .swal2-title {
            padding: 0;
            font-size: 1.25rem;
            text-align: left;
        }

        .diy-swal2-container .swal2-html-container {
            padding: 0;
            margin: 0.5rem 0 0;
            font-size: 1rem;
            text-align: left;
        }

        .diy-swal2-container .swal2-toast .swal2-html-container {
            padding: 0.5rem;
            margin: 0;
            text-align: left;
        }

        .diy-swal2-container .swal2-input {
            height: 1.5rem;
            padding: 0.25rem;
            margin: 0.5rem 0 0;
            font-size: 0.875rem;
        }

        .diy-swal2-container .swal2-actions {
            padding: 0;
            margin: 0.5rem 0 0 0;
        }

        .diy-swal2-container .swal2-actions .swal2-styled {
            height: 2rem;
            line-height: 100%;
            padding: 0 0.625rem;
            margin-top: 0;
            margin-bottom: 0;
        }
    `);

    // 模态对话框
    const getSwal2Base = () => ({
        customClass: {container: 'diy-swal2-container'},
        heightAuto: false,
        draggable: true,
        color: '#e7e7e7',
        background: '#131419',
        backdrop: 'rgba(25,26,36,0.8)',
        confirmButtonColor: '#4357af',
        denyButtonColor: '#ee9a1d',
        cancelButtonColor: '#db3333',
        allowOutsideClick: false,
        allowEscapeKey: false,
        confirmButtonText: i18n.t('confirm'),
        denyButtonText: i18n.t('deny'),
        cancelButtonText: i18n.t('cancel'),
    });
    const modal = {
        useSweetAlert2: true,
        get native() {
            return !(this.useSweetAlert2 && window.Swal);
        },
        _toast: null,
        _toastify(text) {
            if (this.native) return;
            if (!this._toast) {
                this._toast = Swal.mixin({
                    position: 'top',
                    toast: true,
                    timer: 3000,
                    showConfirmButton: false,
                    customClass: {container: 'diy-swal2-container'},
                    color: '#e7e7e7',
                    background: 'rgba(53, 69, 139, 0.9)',
                    didOpen: (toast) => {
                        toast.onmouseenter = Swal.stopTimer;
                        toast.onmouseleave = Swal.resumeTimer;
                    },
                });
            }
            this._toast.fire({text});
        },
        _swal(options) {
            return Swal.fire({...getSwal2Base(), ...options});
        },
        alert(text, title) {
            if (!text) return;
            if (this.native) {
                alert(text);
                return;
            }
            this._swal({title: title || '', html: text.replace(/\r?\n/g, '<br/>')});
        },
        confirm(text, title) {
            if (!text) return Promise.resolve();
            if (this.native) return Promise.resolve(confirm(text));
            return this._swal({title: title || '', html: text.replace(/\r?\n/g, '<br/>'), showCancelButton: true}).then((r) => !!r.isConfirmed);
        },
        prompt(text, title) {
            if (!text) return Promise.resolve();
            if (this.native) return Promise.resolve(prompt(text));
            return this._swal({
                title: title || '',
                html: text.replace(/\r?\n/g, '<br/>'),
                showCancelButton: true,
                input: 'text',
                inputAttributes: {autocomplete: 'off', max: 1000},
            }).then((r) => (r.isConfirmed ? r.value : null));
        },
        toast(text) {
            if (!text) return;
            this._toastify(text);
        },
    };

    // ==================== 工具函数 ====================
    const utils = {
        // 缓存 characterItemMap
        _characterItemMapCache: null,
        _characterItemMapCacheTime: 0,
        _characterItemMapCacheTimeout: 5000, // 缓存5秒

        getItemName(itemUse, itemId) {
            const domName = itemUse?.parentNode?.getAttribute('aria-label') || '';
            return domName || String(itemId || '').replace(/_/g, ' ');
        },
        // 异步 sleep，支持随机延迟
        async sleep(ms) {
            return new Promise((resolve) => setTimeout(resolve, ms));
        },
        async sleepRandom(min = 800, max = 1400) {
            const delay = Math.floor(Math.random() * (max - min + 1)) + min;
            return this.sleep(delay);
        },
        getShowTime(startTime) {
            const time = (new Date().getTime() - startTime) / 1000.0;
            return time > 60 ? i18n.t('minute', (time / 60).toFixed(1)) : i18n.t('second', time.toFixed(1));
        },
        // 获取缓存的 characterItemMap
        getCharacterItemMap() {
            const now = Date.now();
            if (this._characterItemMapCache && now - this._characterItemMapCacheTime < this._characterItemMapCacheTimeout) {
                return this._characterItemMapCache;
            }
            try {
                const headerElement = document.querySelector('.Header_header__1DxsV');
                const reactKey = Reflect.ownKeys(headerElement).find((key) => key.startsWith('__reactProps'));
                const characterItemMap = headerElement[reactKey]?.children?.[0]?._owner?.memoizedProps?.characterItemMap;
                this._characterItemMapCache = characterItemMap || null;
                this._characterItemMapCacheTime = now;
                return this._characterItemMapCache;
            } catch {
                return null;
            }
        },
        // 清除缓存
        clearItemMapCache() {
            this._characterItemMapCache = null;
            this._characterItemMapCacheTime = 0;
        },
        // 获取物品库存数量
        getCountById(itemId, level = 0) {
            try {
                const characterItemMap = this.getCharacterItemMap();
                if (!characterItemMap) return 0;
                const searchSuffix = `::/item_locations/inventory::/items/${itemId}::${level}`;
                for (let [key, value] of characterItemMap) {
                    if (key.endsWith(searchSuffix)) {
                        return value?.count || 0;
                    }
                }
            } catch {}
            return 0;
        },
        getCountByIdAndMax(itemId, maxLevel = 0) {
            if (!itemId) return new Array(maxLevel + 1).fill(0);
            // 获取0到目标等级强化等级的物品数量
            const result = [];
            for (let i = 0; i <= maxLevel; i++) {
                result.push(this.getCountById(itemId, i));
            }
            return result;
        },
        /**
         * 创建强化任务的WebSocket消息
         * @param {*} hrid 物品ItemId
         * @param {*} curLevel 选中的物品等级
         * @param {*} maxLevel 目标等级
         * @param {*} loadoutId 配装ID
         * @param {*} isProtec true使用保护之镜，false使用贤者之镜
         * @returns  {Object} 返回消息体
         */
        createEnhanceMessage(hrid, curLevel, maxLevel, loadoutId, isProtec = true, protecId = null, maxCount = 0) {
            // 普通强化模式下保护物品选择贤者之镜则置为空
            protecId = isProtec && protecId === 'philosophers_mirror' ? null : protecId;
            const secondaryItemId = isProtec ? protecId || 'mirror_of_protection' : 'philosophers_mirror';
            return {
                ts: Date.now(),
                type: 'new_character_action',
                newCharacterActionData: {
                    actionHrid: '/actions/enhancing/enhance',
                    characterLoadoutId: parseInt(loadoutId),
                    difficultyTier: 0,
                    enhancingMaxLevel: parseInt(maxLevel),
                    enhancingProtectionMinLevel: 2,
                    hasMaxCount: maxCount > 0,
                    isStartNow: false,
                    maxCount: maxCount,
                    primaryItemHash: `${characterId}::/item_locations/inventory::/items/${hrid}::${curLevel}`,
                    secondaryItemHash: `${characterId}::/item_locations/inventory::/items/${secondaryItemId}::0`,
                    shouldClearQueue: false,
                },
            };
        },
        sendEnhanceTask(ws, message, timeout = wsReceiveTimeout) {
            if (isDebug) return Promise.resolve({mock: true});
            // 检查连接是否可用
            if (ws?.readyState !== window.WebSocket.OPEN) {
                return Promise.reject(new Error(i18n.t('wsNotConnected')));
            }
            // 发送消息
            try {
                ws.send(JSON.stringify(message));
            } catch (e) {
                // 捕获 send() 同步报错（如参数非法）
                return Promise.reject(e);
            }
            // 返回 Promise 用于后续判断最终结果
            const st = new Date().getTime();
            return new Promise((resolve, reject) => {
                // 监听服务端回执
                const handleReceipt = async (event) => {
                    const receipt = JSON.parse(event.data);
                    // 匹配回执的消息内容
                    if (receipt.type === 'actions_updated' && receipt.endCharacterActions?.length === 1) {
                        const respData = receipt.endCharacterActions[0];
                        const sendData = message.newCharacterActionData;
                        if (
                            respData.isDone === false &&
                            respData.actionHrid === sendData.actionHrid &&
                            respData.enhancingMaxLevel === sendData.enhancingMaxLevel &&
                            respData.primaryItemHash === sendData.primaryItemHash &&
                            respData.secondaryItemHash === sendData.secondaryItemHash
                        ) {
                            cleanUp();
                            resolve(receipt);
                        }
                    } else if (receipt.type === 'error' && receipt.message === 'errorNotification.unexpectedError') {
                        cleanUp();
                        reject(new Error(i18n.t('sendUnexpectedError')));
                    } else if (receipt.type === 'error' && receipt.message === 'errorNotification.requestSpamProtection') {
                        cleanUp();
                        await this.sleep(reqSpamProtecTimeout);
                        reject(new Error(i18n.t('sendSpamProtection')));
                    }
                };

                // 监听发送失败的事件
                const handleError = (error) => {
                    cleanUp();
                    reject(new Error(i18n.t('sendFailed', error.message)));
                };

                // 超时器，避免无限等待
                const timeoutTimer = setTimeout(() => {
                    cleanUp();
                    reject(new Error(i18n.t('sendTimeout', utils.getShowTime(st))));
                }, timeout);

                // 监听停止信号
                const intervalTimer = setInterval(() => {
                    if (components.taskStatus === -1) {
                        cleanUp();
                        reject(new Error(i18n.t('userAbort')));
                    }
                }, 100);

                // 清理事件监听（避免内存泄漏）
                const cleanUp = () => {
                    clearTimeout(timeoutTimer);
                    clearInterval(intervalTimer);
                    ws.removeEventListener('error', handleError);
                    ws.removeEventListener('close', handleError);
                    ws.removeEventListener('message', handleReceipt);
                };

                // 监听错误/关闭事件（代表发送失败）
                ws.addEventListener('error', handleError);
                ws.addEventListener('close', handleError);
                ws.addEventListener('message', handleReceipt);
            });
        },
        /**
         * 计算升级到指定目标需要的强化数量
         * @param {Number} targetLevel 目标等级
         * @param {Number} minLevel  最小等级
         * @param {Number[]} levelCount 当前0~targetLevel的所有数量
         * @return {Number[]} 强化到targetLevel需要的0~targetLevel的数量
         */
        calcEnhanceCount(targetLevel, minLevel, levelCount) {
            const calc = (targetLevel, minLevel, levelCount, enhanceCount) => {
                // 检查目标等级是否已存在
                if (levelCount[targetLevel] > enhanceCount[targetLevel]) {
                    enhanceCount[targetLevel] += 1;
                    return;
                }
                // 接近最小等级则无需继续往下计算
                if (targetLevel === minLevel + 1 || targetLevel === minLevel) {
                    enhanceCount[targetLevel] += 1;
                    return;
                }
                const levelDown1 = targetLevel - 1,
                    levelDown2 = targetLevel - 2;
                // 先合成level-1
                calc(levelDown1, minLevel, levelCount, enhanceCount);
                // 再合成level-2
                calc(levelDown2, minLevel, levelCount, enhanceCount);
            };
            const enhanceCount = new Array(targetLevel + 1).fill(0);
            calc(targetLevel, minLevel, levelCount, enhanceCount);
            return enhanceCount;
        },
        /**
         * 根据所有等级的数量计算强化任务
         * @param {Number[]} levelCount 当前0~targetLevel的所有数量
         * @param {Number[]} enhanceCount 强化到targetLevel需要的0~targetLevel的数量
         * @returns {Object} 返回对象，0表示缺少的空白底子，其他表示对应等级需要使用什么等级来强化
         */
        calcEnhanceTask(levelCount, enhanceCount) {
            const enhanceTask = {},
                _enhanceCount = [...enhanceCount];
            // 计算
            const length = Math.max(levelCount.length, _enhanceCount.length);
            for (let i = 0; i < length; i++) {
                const min = Math.min(levelCount[i], _enhanceCount[i]);
                levelCount[i] -= min;
                _enhanceCount[i] -= min;
            }
            for (let i = 0; i < _enhanceCount.length; i++) {
                while (_enhanceCount[i]-- > 0) {
                    for (let j = i; j >= 0; j--) {
                        if (levelCount[j] > 0) {
                            if (i > j) {
                                enhanceTask[i] = enhanceTask[i] || [];
                                enhanceTask[i].push(j);
                            }
                            levelCount[j]--;
                            break;
                        } else if (j === 0) {
                            enhanceTask[i] = enhanceTask[i] || [];
                            enhanceTask[i].push(j);
                            enhanceTask[0] = (enhanceTask[0] || 0) + 1;
                            break;
                        }
                    }
                }
            }
            return enhanceTask;
        },
        /**
         * 计算合成到targetLevel所需的步骤
         * @param {Number} targetLevel 目标等级
         * @param {Number[]} levelCount 当前0~targetLevel的所有数量
         * @return {Number[]} mergeTask 合成任务
         */
        calcMergeTask(targetLevel, levelCount) {
            const calc = (targetLevel, levelCount, mergeTask) => {
                // 检查目标等级是否已存在
                if (levelCount[targetLevel] > 0) {
                    return;
                }
                // 等级小于2的无法合成
                if (targetLevel < 2) {
                    return;
                }
                const levelDown1 = targetLevel - 1,
                    levelDown2 = targetLevel - 2;
                // 先合成level-1
                if (levelCount[levelDown1] < 1) {
                    calc(levelDown1, levelCount, mergeTask);
                }
                // 再合成level-2
                if (levelCount[levelDown2] < 1) {
                    calc(levelDown2, levelCount, mergeTask);
                }
                // 添加合成任务
                if (levelCount[levelDown1] < 1 || levelCount[levelDown2] < 1) {
                    throw new Error(i18n.t('mergeItemLack', targetLevel));
                } else {
                    mergeTask.push(levelDown1);
                    levelCount[targetLevel] += 1;
                    levelCount[levelDown1] -= 1;
                    levelCount[levelDown2] -= 1;
                }
            };
            const mergeTask = [],
                _levelCount = [...levelCount];
            calc(targetLevel, _levelCount, mergeTask);
            return mergeTask;
        },
        /**
         * 计算合成到targetLevel所需的最短步骤
         * @param {Number} targetLevel 目标等级
         * @param {Number[]} levelCount 当前0~targetLevel的所有数量
         * @return {Number[][]} 合成任务
         */
        calcMinMergeTask(mergeTask) {
            const result = [];
            for (let i = 0; i < mergeTask.length; i++) {
                const cur = mergeTask[i];
                let added = false;
                for (let j = result.length - 1; j >= 0; j--) {
                    if (result[j][1] === cur) {
                        result[j][1] = cur + 1;
                        added = true;
                        break;
                    }
                }
                if (!added) {
                    let ii = -1;
                    for (let j = 0; j < result.length; j++) {
                        if (cur > result[j][0]) {
                            ii = j;
                        } else {
                            break;
                        }
                    }
                    result.splice(ii + 1, 0, [cur, cur + 1]);
                }
            }
            return result;
        },
    };

    // ================== 插件核心函数 ==================
    const components = {
        observeScanId: null,
        taskStatus: 0,
        freedomBtn: null,
        selectBtn: null,
        enhanceBtn: null,
        mergeBtn: null,
        stopBtn: null,
        infoEle: null,

        init(mwiButtonsContainer) {
            if (mwiButtonsContainer.querySelector('#easy20-enhance-btn')) return;
            const btnBase =
                'width: 100%; height: 2.25rem; font-size: 0.875rem; color: white; border: none; border-radius: 4px; cursor: pointer; font-weight: bold;';
            const mkBtn = (id, text, bg, onclick) => {
                const btn = document.createElement('button');
                btn.id = id;
                btn.className = 'easy20-component';
                btn.style.cssText = `${btnBase} background: ${bg};`;
                btn.textContent = text;
                btn.onclick = onclick;
                return btn;
            };
            const mkSelect = (id, opts) => {
                const sel = document.createElement('select');
                sel.id = id;
                sel.style.cssText = 'flex: 1; height: 2.25rem; margin: 0; padding: 0; font-size: 0.875rem; border-radius: 0.25rem; text-align: center;';
                opts.forEach(([val, txt, sel_]) => {
                    const o = document.createElement('option');
                    o.value = val;
                    o.textContent = txt;
                    if (sel_) o.selected = true;
                    sel.appendChild(o);
                });
                return sel;
            };

            const freedomBtn = mkBtn('easy20-freedom-btn', i18n.t('freedom'), '#a272e4', () => this.clickFreedomBtn());
            const enhanceBtn = mkBtn('easy20-enhance-btn', i18n.t('enhanceBaseBtn', 20), '#4357af', () => this.clickEnhanceBtn());
            const mergeBtn = mkBtn('easy20-merge-btn', i18n.t('mergeBtn', 20), '#2fc4a7', () => this.clickMergeBtn());
            const stopBtn = mkBtn('easy20-stop-btn', i18n.t('stopTask'), '#db3333', () => this.clickStopBtn());

            const buttonRow = document.createElement('div');
            buttonRow.className = 'easy20-component';
            buttonRow.style.cssText = 'display: flex; gap: 0.25rem; width: 100%;';

            const selectBtn = mkSelect(
                'easy20-select-btn',
                Array.from({length: 18}, (_, i) => [String(i + 1), `(${i + 1}, ${i + 2})`, i === 8]),
            );
            selectBtn.onchange = () => this.updateTargetOptions();

            const targetBtn = mkSelect('easy20-target-btn', []);
            this._initTargetOptions = (low) => {
                targetBtn.innerHTML = '';
                const minTarget = low + 2;
                for (let level = 3; level <= 20; level++) {
                    const o = document.createElement('option');
                    o.value = level;
                    o.textContent = `+${level}`;
                    if (level < minTarget) o.style.display = 'none';
                    if (level === 20) o.selected = true;
                    targetBtn.appendChild(o);
                }
            };
            this._initTargetOptions(9);
            this.updateTargetOptions = () => {
                const low = parseInt(selectBtn.value);
                const minTarget = low + 2;
                const currentTarget = parseInt(targetBtn.value);
                Array.from(targetBtn.options).forEach((o) => {
                    const lv = parseInt(o.value);
                    o.style.display = lv < minTarget ? 'none' : '';
                });
                if (currentTarget < minTarget) targetBtn.value = minTarget;
                this.changeSelectBtn();
            };
            targetBtn.onchange = () => this.changeSelectBtn();

            buttonRow.appendChild(selectBtn);
            buttonRow.appendChild(targetBtn);

            mwiButtonsContainer.appendChild(freedomBtn);
            mwiButtonsContainer.appendChild(buttonRow);
            mwiButtonsContainer.appendChild(enhanceBtn);
            mwiButtonsContainer.appendChild(mergeBtn);
            mwiButtonsContainer.appendChild(stopBtn);

            this.freedomBtn = freedomBtn;
            this.selectBtn = selectBtn;
            this.targetBtn = targetBtn;
            this.enhanceBtn = enhanceBtn;
            this.mergeBtn = mergeBtn;
            this.stopBtn = stopBtn;
        },

        initInfo() {
            if (document.querySelector('#easy20-info-enhance-wrap')) return;
            const infoContainer = document.querySelector('.EnhancingPanel_enhancingAction__2GJtD .SkillActionDetail_info__3umoI');
            if (!infoContainer) return;

            const targetLevel = this.targetBtn?.value || 20;
            const mkInfoPanel = (id, labelText) => {
                const wrap = document.createElement('div');
                wrap.className = 'easy20-info-wrap easy20-component';
                wrap.style.cssText = 'display: flex; grid-gap: 0.5rem; gap: 0.5rem;';
                const label = document.createElement('div');
                label.className = 'SkillActionDetail_label__1mGQJ';
                label.textContent = labelText;
                const value = document.createElement('div');
                value.className = 'SkillActionDetail_value__dQjYH';
                const infoEle = document.createElement('div');
                infoEle.id = id;
                value.appendChild(infoEle);
                wrap.appendChild(label);
                wrap.appendChild(value);
                infoContainer.appendChild(wrap);
                return [infoEle, label];
            };

            [this.enhanceInfoEle, this.enhanceLabel] = mkInfoPanel('easy20-info-enhance-wrap', i18n.t('baseLabel', targetLevel));
            [this.mergeInfoEle, this.mergeLabel] = mkInfoPanel('easy20-info-merge-wrap', i18n.t('mergeLabel', targetLevel));
            this.changeSelectBtn();
        },

        getBaseInfo() {
            // 强化页面容器
            const root = document.querySelector('.EnhancingPanel_enhancingAction__2GJtD');
            if (!root) {
                return {
                    itemId: null,
                    itemName: '',
                    protecId: null,
                    loadoutId: 0,
                    low: parseInt(this.selectBtn?.value || 0),
                    targetLevel: parseInt(this.targetBtn?.value || 20),
                    get levelCount() {
                        return utils.getCountByIdAndMax(this.itemId, this.targetLevel);
                    },
                };
            }
            // 获取选择的强化物品
            const itemUse = root.querySelector('.SkillActionDetail_primaryItemSelectorContainer__nrvNW use');
            const itemId = itemUse?.getAttribute('href')?.split('#')[1] ?? null;
            const itemName = utils.getItemName(itemUse, itemId);
            // 获取选择的保护物品
            const protecUse = root.querySelector('.SkillActionDetail_protectionItemInputContainer__35ChM .ItemSelector_itemSelector__2eTV6 use');
            const protecId = protecUse?.getAttribute('href')?.split('#')[1] ?? null;
            // 获取配装
            const loadoutInput = root.querySelector('.SkillActionDetail_loadoutDropdown__1wt-0 .MuiSelect-nativeInput');
            return {
                // 强化物品ID
                itemId: itemId,
                // 强化物品名称
                itemName: itemName,
                // 保护物品ID
                protecId: protecId,
                // 配装ID
                loadoutId: parseInt(loadoutInput?.value || 0),
                // 基底等级
                low: parseInt(this.selectBtn?.value),
                // 目标等级
                targetLevel: parseInt(this.targetBtn?.value || 20),
                // 强化等级0到目标等级的物品数量
                get levelCount() {
                    return utils.getCountByIdAndMax(this.itemId, this.targetLevel);
                },
            };
        },

        getCurrentItemName(itemId, fallbackName = '') {
            const root = document.querySelector('.EnhancingPanel_enhancingAction__2GJtD');
            const itemUse = root?.querySelector('.SkillActionDetail_primaryItemSelectorContainer__nrvNW use');
            const currentItemId = itemUse?.getAttribute('href')?.split('#')[1] ?? null;
            if (currentItemId && currentItemId === itemId) {
                return utils.getItemName(itemUse, itemId);
            }
            return fallbackName || String(itemId || '').replace(/_/g, ' ');
        },

        checkTaskBefore(baseInfo) {
            if (!ws) throw new Error(i18n.t('checkWsNotConnected'));
            if (!baseInfo?.itemId) throw new Error(i18n.t('itemInfoMissing'));
            const statusMsgs = {
                1: i18n.t('taskBatchEnhanceBase'),
                2: i18n.t('taskBatchMerge', baseInfo.targetLevel),
                3: i18n.t('freedom'),
            };
            if (this.taskStatus === -1) throw new Error(i18n.t('taskStopping'));
            if (this.taskStatus > 0) throw new Error(i18n.t('taskRunning', statusMsgs[this.taskStatus] || i18n.t('taskBatchEnhanceBase')));
        },

        parseFreedomExpression(input) {
            if (!input) return [];
            const regex = /^(?:(?:(\+)?(?:((?:(\d{1,2})~)?(1?\d))-))?([1-9]|1\d|20))(?:\s*[:：]\s*(\d{1,4}))?\s*[:：]\s*(\d{1,4}|@)$/;
            return input
                .trim()
                .split(/\s*[,，;；]\s*/)
                .map((v) => {
                    let m = null;
                    if ((m = regex.exec(v)) !== null) {
                        const r = {
                            input: v,
                            isProtec: m[1] !== '+',
                            start: m[2],
                            start1: parseInt(m[3] || -1),
                            start2: parseInt(m[4] || 0),
                            target: parseInt(m[5]),
                            repeat: parseInt(m[6] || 0),
                            count: m[7] === '@' ? 0 : parseInt(m[7]),
                            countAuto: m[7] === '@',
                        };
                        r.success = r.start1 < r.start2 && r.start2 < r.target && (r.count > 0 || r.countAuto);
                        return r;
                    } else {
                        return {success: false, input: v};
                    }
                });
        },

        async clickFreedomBtn() {
            const baseInfo = this.getBaseInfo();
            try {
                this.checkTaskBefore(baseInfo);
            } catch (e) {
                modal.toast(e.message);
                return;
            }
            const itemId = baseInfo.itemId;
            const getItemName = () => this.getCurrentItemName(itemId, baseInfo.itemName);
            const loadoutId = baseInfo.loadoutId;
            const protecId = baseInfo.protecId;

            // 自由强化提示信息
            if (!(await modal.confirm(i18n.t('freedomTips'), i18n.t('freedomTipTitle')))) return;

            const input = (await modal.prompt(i18n.t('freedomUseInfo'), i18n.t('freedom'))) || '';

            // 解析输入的表达式
            const result = this.parseFreedomExpression(input);
            console.log('自由强化表达式解析结果', result);

            // 展示解析结果
            if (result.length === 0) return;
            let errCnt = 0, maxLevel = 0;
            const parseInfo = result
                .map((v, i) => {
                    errCnt += v.success ? 0 : 1;
                    maxLevel = Math.max(maxLevel, v.start2);
                    const repeatText = v.repeat === 0 ? '' : i18n.t('repeatTimes', v.repeat);
                    const countText = i18n.t('taskCount', v.countAuto ? i18n.t('auto') : v.count);
                    return !v.success
                        ? i18n.t('freedomParseFailed', i + 1, v.input)
                        : i18n.t(
                              'freedomParseLine',
                              i + 1,
                              v.isProtec ? i18n.t('normalEnhance') : i18n.t('philosopherMerge'),
                              getItemName(),
                              v.start || v.start2,
                              v.target,
                              repeatText,
                              countText,
                          );
                })
                .join('\n');
            if (errCnt > 0) {
                modal.alert(parseInfo, i18n.t('freedomParseTitle'));
                return;
            }
            if (!(await modal.confirm(parseInfo, i18n.t('freedomParseTitle')))) return;

            // 获取库存数量
            const levelCount = utils.getCountByIdAndMax(itemId, maxLevel);
            const st = new Date().getTime();
            try {
                // 发送强化指令
                this.taskStatus = 3;
                let sum = 0,
                    round = 0;
                for (const v of result) {
                    if (!v.success) continue;
                    round++;
                    const {isProtec, start, start1, start2, target, repeat, countAuto} = v;
                    let {count} = v;
                    const _loadoutId = isProtec ? loadoutId : 0;
                    if (countAuto) count = levelCount.slice(Math.max(0, start1), start2 + 1).reduce((sum, val) => sum + val, 0);
                    const getInfo = () =>
                        i18n.t(
                            'freedomInfo',
                            round,
                            isProtec ? i18n.t('normalEnhance') : i18n.t('philosopherMerge'),
                            getItemName(),
                            start || start2,
                            target,
                        );
                    const info = getInfo();
                    console.log(`自由强化，匹配内容：${v.input}，${info}`, levelCount);
                    for (let i = 0; i < count; i++) {
                        // 查找实际起始等级
                        let cur = start2;
                        if (start1 >= 0) {
                            for (; cur >= start1; cur--) {
                                if (cur === 0 || levelCount[cur] > 0) {
                                    break;
                                }
                            }
                        }
                        levelCount[cur]--;
                        let retryCnt = 0;
                        while (retryCnt++ <= retry) {
                            try {
                                if (this.taskStatus === -1) {
                                    modal.alert(
                                        i18n.t('freedomAbort', round, sum, getItemName(), utils.getShowTime(st)),
                                        i18n.t('freedom'),
                                    );
                                    return;
                                }
                                const message = utils.createEnhanceMessage(itemId, cur, target, _loadoutId, isProtec, protecId, repeat);
                                const result = await utils.sendEnhanceTask(ws, message);
                                const msg = i18n.t('freedomToastSuccess', getInfo(), i + 1, count);
                                // console.log(msg, message, result);
                                modal.toast(msg);
                                sum++;
                                if (this.taskStatus > 0) await utils.sleepRandom(addQueueSleepMinTime, addQueueSleepMaxTime);
                                break;
                            } catch (err) {
                                if (retryCnt > retry) throw err;
                                const msg = i18n.t('freedomToastRetry', getInfo(), i + 1, count, retryCnt, err.message || '');
                                console.log(msg);
                                modal.toast(msg);
                            }
                        }
                    }
                }

                modal.alert(i18n.t('freedomSuccess', round, sum, getItemName(), utils.getShowTime(st)), i18n.t('freedom'));
            } catch (err) {
                console.error(err);
                modal.alert(i18n.t('freedomError', utils.getShowTime(st), err.message || ''), i18n.t('freedom'));
            } finally {
                this.taskStatus = 0;
            }
            console.log('自由强化结束，levelCount', levelCount);
        },

        changeSelectBtn() {
            const baseInfo = this.getBaseInfo();
            const itemId = baseInfo.itemId;
            const low = baseInfo.low; // 选中的基底等级
            const targetLevel = baseInfo.targetLevel; // 目标等级

            // 同步更新批量按钮文本
            if (this.freedomBtn) {
                this.freedomBtn.textContent = i18n.t('freedom');
            }
            if (this.enhanceBtn) {
                this.enhanceBtn.textContent = i18n.t('enhanceBaseBtn', targetLevel);
            }
            if (this.mergeBtn) {
                this.mergeBtn.textContent = i18n.t('mergeBtn', targetLevel);
            }
            if (this.stopBtn) {
                this.stopBtn.textContent = i18n.t('stopTask');
            }

            // 更新标签文本
            if (this.enhanceLabel) {
                this.enhanceLabel.textContent = i18n.t('baseLabel', targetLevel);
            }
            if (this.mergeLabel) {
                this.mergeLabel.textContent = i18n.t('mergeLabel', targetLevel);
            }

            if (!itemId) {
                if (this.enhanceInfoEle) this.enhanceInfoEle.textContent = '';
                if (this.mergeInfoEle) this.mergeInfoEle.textContent = '';
                return;
            }

            // 获取0到targetLevel强化等级的物品数量
            const levelCount = baseInfo.levelCount;
            // 已存在targetLevel的则忽略
            levelCount[targetLevel] = 0;
            // 获取强化所需数量
            const enhanceCount = utils.calcEnhanceCount(targetLevel, low, levelCount);

            // 生成基底强化提示信息
            let lackSum = 0;
            let enhanceInfoArr = [];
            for (let i = enhanceCount.length - 1; i >= 0; i--) {
                const need = enhanceCount[i];
                if (need > 0) {
                    const exist = levelCount[i] ?? 0;
                    const lack = need - exist;
                    let msg = `+${i}: ${exist}/${need}`;
                    if (lack > 0) {
                        lackSum += lack;
                        msg += i18n.t('lack', lack);
                    } else if (lack < 0) {
                        msg += i18n.t('extra', lack * -1);
                    }
                    enhanceInfoArr.push(msg);
                }
            }
            if (lackSum > 0) {
                enhanceInfoArr.push(i18n.t('needEnhanceBase', lackSum));
            }

            // 写入基底强化提示信息
            if (this.enhanceInfoEle) {
                this.enhanceInfoEle.innerHTML = enhanceInfoArr.join('<br/>');
            }

            // 生成合成提示信息
            let mergeInfoArr = [];
            try {
                const mergeTask = utils.calcMergeTask(targetLevel, levelCount);
                if (mergeTask.length > 0) {
                    const minMergeTask = utils.calcMinMergeTask(mergeTask);
                    mergeInfoArr.push(i18n.t('mergeBaseEnough', targetLevel));
                    mergeInfoArr.push(i18n.t('needPhilosophersMirror', mergeTask.length));
                    mergeInfoArr.push(i18n.t('needMergeTasks', minMergeTask.length));
                } else {
                    mergeInfoArr.push(i18n.t('waitBaseEnhance'));
                }
            } catch (e) {
                mergeInfoArr.push(i18n.t('mergeItemLack', targetLevel));
            }

            // 写入合成提示信息
            if (this.mergeInfoEle) {
                this.mergeInfoEle.innerHTML = mergeInfoArr.join('<br/>');
            }
        },
        async clickEnhanceBtn() {
            const baseInfo = this.getBaseInfo();
            try {
                this.checkTaskBefore(baseInfo);
            } catch (e) {
                modal.toast(e.message);
                return;
            }
            const itemId = baseInfo.itemId;
            const getItemName = () => this.getCurrentItemName(itemId, baseInfo.itemName);
            const loadoutId = baseInfo.loadoutId;
            const low = baseInfo.low; // 选中的基底等级
            const targetLevel = baseInfo.targetLevel; // 目标等级
            const protecId = baseInfo.protecId;

            // 获取0到targetLevel强化等级的物品数量
            const levelCount = baseInfo.levelCount;
            // 已存在targetLevel的则忽略
            levelCount[targetLevel] = 0;
            // 获取强化所需数量
            const enhanceCount = utils.calcEnhanceCount(targetLevel, low, levelCount);
            const sumEnhanceCount = enhanceCount.reduce((pv, cv) => pv + cv, 0);

            if (sumEnhanceCount > 5000) {
                modal.toast(i18n.t('safeLimitExceeded', low, low + 1, targetLevel, sumEnhanceCount));
                return;
            }

            if (sumEnhanceCount === 0) {
                modal.toast(i18n.t('zeroEnhanceCount'));
                return;
            }

            // 获取强化队列
            const enhanceTask = utils.calcEnhanceTask(levelCount, enhanceCount);
            if ((enhanceTask[0] ?? 0) > 0) {
                modal.toast(i18n.t('missingBaseItems', getItemName(), enhanceTask[0]));
                return;
            }

            // 获取待强化的物品等级
            const enhanceTaskKeys = Object.keys(enhanceTask).sort((a, b) => a - b);

            if (enhanceTaskKeys.length === 0) {
                modal.toast(i18n.t('baseEnhanceDone'));
                return;
            }

            // 弹出提示信息
            if (!(await modal.confirm(i18n.t('enhanceTips'), i18n.t('enhanceBaseBtn', targetLevel)))) return;

            console.log(`批量强化基底，enhanceCount, enhanceTask`, enhanceCount, enhanceTask);

            const st = new Date().getTime();
            try {
                // 发送强化指令
                this.taskStatus = 1;
                let sum = 0;
                for (const key in enhanceTaskKeys) {
                    const value = enhanceTaskKeys[key];
                    const level = parseInt(value);
                    const childTask = enhanceTask[value];
                    for (let i = 0; i < childTask.length; i++) {
                        let retryCnt = 0;
                        while (retryCnt++ <= retry) {
                            try {
                                if (this.taskStatus === -1) {
                                    modal.alert(
                                        i18n.t('enhanceAbort', low, low + 1, targetLevel, sum, getItemName(), utils.getShowTime(st)),
                                        i18n.t('enhanceBaseBtn', targetLevel),
                                    );
                                    return;
                                }
                                const message = utils.createEnhanceMessage(itemId, childTask[i], level, loadoutId, true, protecId);
                                const result = await utils.sendEnhanceTask(ws, message);
                                const msg = i18n.t('enhanceToastSuccess', getItemName(), level, i + 1, childTask.length);
                                // console.log(msg, message, result);
                                modal.toast(msg);
                                sum++;
                                if (this.taskStatus > 0) await utils.sleepRandom(addQueueSleepMinTime, addQueueSleepMaxTime);
                                break;
                            } catch (err) {
                                if (retryCnt > retry) throw err;
                                const msg = i18n.t('enhanceToastRetry', getItemName(), level, i + 1, childTask.length, retryCnt, err.message || '');
                                console.log(msg);
                                modal.toast(msg);
                            }
                        }
                    }
                }

                modal.alert(
                    i18n.t('enhanceSuccess', low, low + 1, targetLevel, sum, getItemName(), utils.getShowTime(st)),
                    i18n.t('enhanceBaseBtn', targetLevel),
                );
            } catch (err) {
                console.error(err);
                modal.alert(
                    i18n.t('enhanceError', utils.getShowTime(st), err.message || ''),
                    i18n.t('enhanceBaseBtn', targetLevel),
                );
            } finally {
                this.taskStatus = 0;
            }
        },
        async clickMergeBtn() {
            const baseInfo = this.getBaseInfo();
            try {
                this.checkTaskBefore(baseInfo);
            } catch (e) {
                modal.toast(e.message);
                return;
            }
            const itemId = baseInfo.itemId;
            const getItemName = () => this.getCurrentItemName(itemId, baseInfo.itemName);
            const loadoutId = 0; // 合成使用无配装，避免配装影响合成
            const targetLevel = baseInfo.targetLevel; // 目标等级

            // 获取0到targetLevel强化等级的物品数量
            const levelCount = baseInfo.levelCount;
            // 已存在targetLevel的则忽略，使用低等级继续合成
            levelCount[targetLevel] = 0;
            try {
                // 获取合成任务
                const mergeTask = utils.calcMergeTask(targetLevel, levelCount);
                const minMergeTask = utils.calcMinMergeTask(mergeTask);

                // 弹出提示信息
                if (!(await modal.confirm(i18n.t('mergeTips'), i18n.t('mergeTipTitle', targetLevel)))) return;

                console.log(`批量合成+${targetLevel}，levelCount, mergeTask, minMergeTask`, levelCount, mergeTask, minMergeTask);

                const st = new Date().getTime();
                try {
                    // 发送强化指令
                    this.taskStatus = 2;
                    let sum = 0;
                    for (let i = 0; i < minMergeTask.length; i++) {
                        let retryCnt = 0;
                        while (retryCnt++ <= retry) {
                            const level = minMergeTask[i][0],
                                maxLevel = minMergeTask[i][1];
                            try {
                                if (this.taskStatus === -1) {
                                    modal.alert(
                                        i18n.t('mergeAbort', targetLevel, sum, getItemName(), utils.getShowTime(st)),
                                        i18n.t('mergeBtn', targetLevel),
                                    );
                                    return;
                                }
                                const message = utils.createEnhanceMessage(itemId, level, maxLevel, loadoutId, false);
                                const result = await utils.sendEnhanceTask(ws, message);
                                const msg = i18n.t('mergeToastSuccess', targetLevel, getItemName(), i + 1, minMergeTask.length, level, maxLevel);
                                // console.log(msg, message, result);
                                modal.toast(msg);
                                sum++;
                                if (this.taskStatus > 0) await utils.sleepRandom(addQueueSleepMinTime, addQueueSleepMaxTime);
                                break;
                            } catch (err) {
                                if (retryCnt > retry) throw err;
                                const msg = i18n.t(
                                    'mergeToastRetry',
                                    targetLevel,
                                    getItemName(),
                                    i + 1,
                                    minMergeTask.length,
                                    level,
                                    maxLevel,
                                    retryCnt,
                                    err.message || '',
                                );
                                console.log(msg);
                                modal.toast(msg);
                            }
                        }
                    }

                    modal.alert(
                        i18n.t('mergeSuccess', targetLevel, sum, getItemName(), utils.getShowTime(st)),
                        i18n.t('mergeBtn', targetLevel),
                    );
                } catch (err) {
                    console.error(err);
                    modal.alert(
                        i18n.t('mergeError', targetLevel, utils.getShowTime(st), err.message || ''),
                        i18n.t('mergeBtn', targetLevel),
                    );
                } finally {
                    this.taskStatus = 0;
                }
            } catch (err) {
                console.error(err);
                modal.toast(i18n.t('mergeCheckFailed', targetLevel));
            }
        },
        clickStopBtn() {
            // 存在任务执行中则修改为停止状态
            if (this.taskStatus > 0) {
                this.taskStatus = -1;
            }
        },

        hideQueuedActions() {
            if (document.querySelector('#easy20-hide-queued-actions')) {
                return;
            }
            const style = document.createElement('style');
            style.id = 'easy20-hide-queued-actions';
            style.textContent = `
                .MuiTooltip-tooltip:has(> .QueuedActions_queuedActionsEditMenu__3OoQH),
                .QueuedActions_queuedActionsEditMenu__3OoQH,
                .QueuedActions_queuedActionsEditMenu__3OoQH .QueuedActions_actions__2Lur6,
                .QueuedActions_queuedActionsEditMenu__3OoQH .QueuedActions_action__r3HlD {
                    display: none !important;
                    visibility: hidden !important;
                }
            `;
            document.head.appendChild(style);
        },

        cancelHideQueuedActions() {
            document.querySelector('#easy20-hide-queued-actions')?.remove();
        },

        refreshLanguage() {
            utils.clearItemMapCache();
            this.changeSelectBtn();
        }
    };

    class LanguageController {
        constructor() {
            this.isInitialized = false;
        }

        patchLocalStorageEvent() {
            if (localStorage._easy20SetItemPatched) return;
            const originalSetItem = localStorage.setItem;
            localStorage.setItem = function (key, value) {
                const oldValue = localStorage.getItem(key);
                originalSetItem.apply(this, arguments);
                const event = new Event('easy20-local-storage-changed');
                event.key = key;
                event.oldValue = oldValue;
                event.newValue = value;
                window.dispatchEvent(event);
            };
            localStorage._easy20SetItemPatched = true;
        }

        syncFromGameSetting(nextValue) {
            const nextLang = nextValue?.toLowerCase()?.startsWith('zh') ? 'zh' : 'en';
            if (i18n.currentLang === nextLang) return;
            i18n.currentLang = nextLang;
            components.refreshLanguage();
        }

        init() {
            if (this.isInitialized) return;
            this.isInitialized = true;
            this.patchLocalStorageEvent();
            window.addEventListener('easy20-local-storage-changed', (event) => {
                if (event.key === 'i18nextLng') this.syncFromGameSetting(event.newValue);
            });
            window.addEventListener('storage', (event) => {
                if (event.key === 'i18nextLng') this.syncFromGameSetting(event.newValue);
            });
            window.addEventListener('MWILangChanged', () => {
                this.syncFromGameSetting(localStorage.getItem('i18nextLng'));
            });
        }
    }

    new LanguageController().init();

    // Hook WebSocket（支持所有域名）
    const origDataGet = Object.getOwnPropertyDescriptor(MessageEvent.prototype, 'data').get;
    Object.defineProperty(MessageEvent.prototype, 'data', {
        get: function () {
            const data = origDataGet.call(this);
            const socket = this.currentTarget;
            if (
                socket instanceof WebSocket &&
                (socket.url.includes('milkywayidle.com/ws') || socket.url.includes('milkywayidlecn.com/ws')) &&
                socket.readyState === 1
            ) {
                ws = socket;
            }
            return data;
        },
        configurable: true,
    });

    // 监控页面变化，添加自定义控件
    const observer = new MutationObserver((mutationsList) => {
        // // 任务执行中，禁用行动队列提示框显示
        // if (components.taskStatus !== 0 && document.querySelector('.QueuedActions_queuedActionsEditMenu__3OoQH')) {
        //     // 点击队列按钮会导致销毁节点，然后又创建大量DOM节点，内存占用非常高
        //     document.querySelector('.QueuedActions_queuedActions__2xerL')?.click();
        // }
        // 任务执行中，禁用行动队列提示框显示。使用CSS屏蔽元素展示避免频繁销毁DOM节点降低内存占用
        if (components.taskStatus !== 0) {
            components.hideQueuedActions();
        } else {
            components.cancelHideQueuedActions();
        }

        // 判断是否是在强化页面
        const mwiEnhanceBtn = document.querySelector('.EnhancingPanel_enhancingAction__2GJtD .Button_success__6d6kU');
        if (!mwiEnhanceBtn) {
            document.querySelectorAll('.easy20-component')?.forEach((el) => el.remove());
            return;
        }

        // 初始化按钮组件
        const mwiButtonsContainer = mwiEnhanceBtn.parentNode;
        components.init(mwiButtonsContainer);

        // 初始化提示信息组件
        components.initInfo();

        // 获取选中的物品itemId
        const itemContainer = document.querySelector(
            '.EnhancingPanel_enhancingAction__2GJtD .SkillActionDetail_primaryItemSelectorContainer__nrvNW',
        );
        if (itemContainer) {
            for (const mutation of mutationsList) {
                const isTargetAffected =
                    // 变化的节点是目标节点本身
                    mutation.target === itemContainer ||
                    // 变化的节点是目标节点的后代（如需仅监控自身可去掉此判断）
                    itemContainer.contains(mutation.target);
                if (isTargetAffected) {
                    if (!components.observeScanId) {
                        components.observeScanId = setTimeout(() => {
                            utils.clearItemMapCache(); // 清除缓存，确保数据最新
                            components.changeSelectBtn();
                            components.observeScanId = null;
                        }, 100);
                    }
                    break;
                }
            }
        }
    });

    observer.observe(document.body, {childList: true, subtree: true, attributes: true, characterData: true});

    // 页面卸载时断开 observer，避免内存泄漏
    window.addEventListener('beforeunload', () => observer.disconnect());

    console.log(i18n.t('scriptLoaded'));
})();
