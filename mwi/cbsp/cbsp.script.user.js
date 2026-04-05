// ==UserScript==
// @name         [银河奶牛]购买牛铃（测试服专用）
// @version      1.0.0
// @namespace    http://tampermonkey.net/
// @description  测试服自动充值牛铃
// @author       sunrishe
// @match        https://test.milkywayidle.com/*
// @match        https://test.milkywayidlecn.com/*
// @match        https://checkout.stripe.com/*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=milkywayidle.com
// @grant        unsafeWindow
// @grant        GM_getValue
// @grant        GM_setValue
// @run-at       document-start
// @license      MIT
// @homepage     https://github.com/sunrishe/tampermonkey/tree/master/mwi/cbsp
// @downloadURL  https://raw.githubusercontent.com/sunrishe/tampermonkey/refs/heads/master/mwi/cbsp/cbsp.script.user.js
// @updateURL    https://raw.githubusercontent.com/sunrishe/tampermonkey/refs/heads/master/mwi/cbsp/cbsp.script.user.js
// ==/UserScript==

(function (window) {
    'use strict';

    // 使用说明
    // 1.需要在浏览器手动使用Link支付完成一次测试服牛铃购买后再刷新页面使用脚本
    // 2.油猴设置-安全-黑名单页面，去掉包含stripe.com的一行，不然脚本不执行

    // ==================== 常量定义 ====================
    const CONFIG = {
        REQ_SPAM_PROTECT_TIMEOUT: 3000,
        AUTO_BUY_SLEEP_MIN: 800,
        AUTO_BUY_SLEEP_MAX: 1200,
        CLICK_RANDOM_PADDING: 2,
        PAYMENT_CHECK_INTERVAL: 300,
        PAYMENT_DELAY: 500,
        MAX_BUY_RESULT_WAIT: 300000,
    };

    const SELECTORS = {
        // 牛铃商店
        BUY_COWBELLS_TAB: '.CowbellStorePanel_buyCowbellsTab__3TZNk',
        CREATOR_CODE_SECTION: '.CowbellStorePanel_creatorCodeSection__35c7s',
        PURCHASE_BUNDLES: '.CowbellStorePanel_purchaseBundles__1kSQp',
        BUYABLE_LAST: '.CowbellStorePanel_buyable__2hbYz:last-child',
        MODAL_CONTENT: '.CowbellStorePanel_modalContent__1JNWg',
        MODAL_SUCCESS_BTN: '.Button_success__6d6kU',
        // 支付页面
        LINE_ITEM_DESC: '.LineItem-description',
        ADJUST_QUANTITY_MODAL: '.AdjustQuantityModal-modal',
        QUANTITY_ICON: '.AdjustableQuantitySelector-icon',
        QUANTITY_HITBOX: '.AdjustableQuantitySelector-hitBox',
        ADJUST_QUANTITY_INPUT: '#adjustQuantity',
        ADJUST_QUANTITY_FOOTER_BTN: '.AdjustQuantityFooter-btn',
        ADJUST_QUANTITY_CLOSE_BTN: '.AdjustQuantityHeader-closeBtn',
        CONFIRM_PAYMENT_BTN: '.ConfirmPaymentButton--SubmitButton .SubmitButton',
        SUBMIT_BUTTON_TEXT: '.SubmitButton-TextContainer .SubmitButton-Text--current',
        PAYMENT_SUCCESS_PAGE: '.PaymentSuccessPage_paymentSuccessPage__1TJS3',
        // 游戏主面板
        MAIN_PANEL: '.GamePage_mainPanel__2njyb',
    };

    const MESSAGES = {
        BUY_COMPLETE: 'infoNotification.cowbellPurchaseCompleted',
        UNEXPECTED_ERROR: 'errorNotification.unexpectedError',
        REQUEST_SPAM: 'errorNotification.requestSpamProtection',
    };

    const GM_KEYS = {
        TASK_STATUS: 'mwi-auto-buy-taskStatus',
    };

    // ==================== 工具函数 ====================
    const utils = {
        sleep(ms) {
            return new Promise((resolve) => setTimeout(resolve, ms));
        },

        sleepRandom(min = CONFIG.AUTO_BUY_SLEEP_MIN, max = CONFIG.AUTO_BUY_SLEEP_MAX) {
            const delay = Math.floor(Math.random() * (max - min + 1)) + min;
            return this.sleep(delay);
        },

        getShowTime(startTime) {
            const elapsed = new Date().getTime() - startTime;
            const seconds = Math.floor(elapsed / 1000);
            const minutes = Math.floor(seconds / 60);
            const remainingSeconds = seconds % 60;
            return minutes > 0 ? `${minutes}分${remainingSeconds}秒` : `${remainingSeconds}秒`;
        },

        isElementVisible(el) {
            if (!el) return false;
            let node = el;
            while (node && node.nodeType === 1) {
                const sty = window.getComputedStyle(node);
                if (
                    sty.display === 'none' ||
                    sty.visibility === 'hidden' ||
                    parseFloat(sty.opacity) <= 0 ||
                    (parseFloat(sty.width) <= 0 && parseFloat(sty.height) <= 0)
                ) {
                    return false;
                }
                node = node.parentElement;
            }
            return true;
        },

        randomClickElement(el) {
            if (!el) return;
            const rect = el.getBoundingClientRect();
            const padding = CONFIG.CLICK_RANDOM_PADDING;
            const randX = rect.left + padding + Math.random() * (rect.width - padding * 2);
            const randY = rect.top + padding + Math.random() * (rect.height - padding * 2);

            const evtOpt = {
                bubbles: true,
                cancelable: true,
                view: window,
                which: 1,
                button: 0,
                clientX: randX,
                clientY: randY,
                screenX: randX,
                screenY: randY,
            };

            el.dispatchEvent(new MouseEvent('mousedown', evtOpt));
            el.dispatchEvent(new MouseEvent('mouseup', evtOpt));
            el.dispatchEvent(new MouseEvent('click', evtOpt));
        },

        inputSetValue(inputDom, value) {
            if (!inputDom) return;
            const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
            inputDom.focus();
            nativeInputValueSetter.call(inputDom, value);
            inputDom.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
            inputDom.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));
            inputDom.select();
            const chars = value.split('');
            chars.forEach((ch) => {
                inputDom.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: ch, char: ch }));
                inputDom.dispatchEvent(new KeyboardEvent('keypress', { bubbles: true, cancelable: true, key: ch, char: ch }));
                inputDom.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, cancelable: true, key: ch, char: ch }));
            });
        },

        waitBuyResult(wsInstance, timeout = CONFIG.MAX_BUY_RESULT_WAIT) {
            if (wsInstance?.readyState !== window.WebSocket.OPEN) {
                return Promise.reject(new Error('WebSocket 未连接，无法发送消息'));
            }

            const startTime = new Date().getTime();
            return new Promise((resolve, reject) => {
                const cleanUp = () => {
                    clearTimeout(timeoutTimer);
                    clearInterval(intervalTimer);
                    wsInstance.removeEventListener('error', handleError);
                    wsInstance.removeEventListener('close', handleError);
                    wsInstance.removeEventListener('message', handleReceipt);
                };

                const handleReceipt = async (event) => {
                    const receipt = JSON.parse(event.data);
                    if (receipt.type === 'info' && receipt.message === MESSAGES.BUY_COMPLETE) {
                        cleanUp();
                        resolve(receipt);
                    } else if (receipt.type === 'error' && receipt.message === MESSAGES.UNEXPECTED_ERROR) {
                        cleanUp();
                        reject(new Error('消息发送失败: 发生意外错误'));
                    } else if (receipt.type === 'error' && receipt.message === MESSAGES.REQUEST_SPAM) {
                        cleanUp();
                        await this.sleep(CONFIG.REQ_SPAM_PROTECT_TIMEOUT);
                        reject(new Error('消息发送失败: 请勿过快发送游戏指令'));
                    }
                };

                const handleError = (error) => {
                    cleanUp();
                    reject(new Error(`消息发送失败: ${error.message}`));
                };

                const timeoutTimer = setTimeout(() => {
                    cleanUp();
                    reject(new Error(`消息发送超时，已等待${this.getShowTime(startTime)}`));
                }, timeout);

                const intervalTimer = setInterval(() => {
                    if (mwiComponents.taskStatus === -1) {
                        cleanUp();
                        reject(new Error('用户中止任务'));
                    }
                }, 100);

                wsInstance.addEventListener('error', handleError);
                wsInstance.addEventListener('close', handleError);
                wsInstance.addEventListener('message', handleReceipt);
            });
        },
    };

    // ==================== 牛铃商店组件 ====================
    let ws = null;

    const mwiComponents = {
        taskStatus: 0,
        autoBuyStatus: 0,
        autoBuyBtn: null,
        stopBuyBtn: null,

        init(buyCowbellsTab) {
            if (buyCowbellsTab.querySelector('#auto-buy-cowbells-btn')) return;

            const itemMenu = buyCowbellsTab.querySelector(SELECTORS.CREATOR_CODE_SECTION);
            const buttons = itemMenu.querySelectorAll('button');
            const lastButton = buttons[buttons.length - 1];

            // 创建自动购买按钮
            this.autoBuyBtn = lastButton.cloneNode(true);
            this.autoBuyBtn.textContent = '自动购买牛铃';
            this.autoBuyBtn.id = 'auto-buy-cowbells-btn';
            this.autoBuyBtn.classList.add('auto-buy-component');
            this.autoBuyBtn.onclick = () => this.clickAutoBuyBtn();
            itemMenu.appendChild(this.autoBuyBtn);

            // 创建停止购买按钮
            this.stopBuyBtn = lastButton.cloneNode(true);
            this.stopBuyBtn.textContent = '停止购买';
            this.stopBuyBtn.id = 'auto-buy-stop-btn';
            this.stopBuyBtn.classList.add('auto-buy-component');
            this.stopBuyBtn.onclick = () => this.clickStopBuyBtn();
            itemMenu.appendChild(this.stopBuyBtn);
        },

        clickAutoBuyBtn() {
            if (this.taskStatus !== 0) return;

            this.taskStatus = 1;
            this.autoBuyStatus = 0;
            this.saveTaskStatus();

            const observer = new MutationObserver(() => {
                const buyCowbellsTab = document.querySelector(SELECTORS.BUY_COWBELLS_TAB);

                if (!utils.isElementVisible(buyCowbellsTab)) {
                    return;
                }

                if (this.taskStatus <= 0) {
                    this.taskStatus = 0;
                    this.autoBuyStatus = 0;
                    this.saveTaskStatus();
                    observer.disconnect();
                    return;
                }

                this.saveTaskStatus();
                this.processAutoBuyState(buyCowbellsTab);
            });

            observer.observe(document.body, {
                childList: true,
                subtree: true,
                attributes: true,
                characterData: true,
            });

            window.addEventListener('beforeunload', () => observer.disconnect());
        },

        processAutoBuyState(buyCowbellsTab) {
            if (this.autoBuyStatus === 0) {
                const lastBuy = buyCowbellsTab.querySelector(
                    `${SELECTORS.PURCHASE_BUNDLES} ${SELECTORS.BUYABLE_LAST}`,
                );
                if (!lastBuy) return;

                console.log('[MWI购买牛铃] 点击牛铃袋');
                utils.randomClickElement(lastBuy);
                this.autoBuyStatus = 1;
            } else if (this.autoBuyStatus === 1) {
                const buyBtn = document.querySelector(`${SELECTORS.MODAL_CONTENT} ${SELECTORS.MODAL_SUCCESS_BTN}`);
                if (!buyBtn) return;

                this.autoBuyStatus = 2;
                utils.sleepRandom(500, 800).then(() => {
                    if (this.taskStatus <= 0) return;

                    console.log('[MWI购买牛铃] 点击购买弹窗继续按钮');
                    utils.randomClickElement(buyBtn);
                    this.autoBuyStatus = 3;

                    const buyCallback = (success, result) => {
                        utils.sleepRandom().then(() => {
                            if (success) {
                                console.log('[MWI购买牛铃] 购买牛铃成功');
                            } else {
                                console.error('[MWI购买牛铃] 购买牛铃失败:', result);
                            }
                            this.autoBuyStatus = 0;
                        });
                    };

                    utils.waitBuyResult(ws)
                        .then((r) => buyCallback(true, r))
                        .catch((err) => buyCallback(false, err));
                });
            }
        },

        clickStopBuyBtn() {
            console.log('[MWI购买牛铃] 点击停止购买按钮');
            if (this.taskStatus > 0) {
                this.taskStatus = -1;
                this.saveTaskStatus();
            }
        },

        saveTaskStatus() {
            GM_setValue(GM_KEYS.TASK_STATUS, this.taskStatus);
        },
    };

    // ==================== 支付页面组件 ====================
    const paymentComponents = {
        scanId: null,
        execId: null,

        checkQuantity(container) {
            const slEle = container?.querySelector(SELECTORS.QUANTITY_ICON)?.previousElementSibling;
            return slEle?.textContent.replace(/\s+/g, '') === '数量99';
        },

        async autoPayment() {
            const quantityContainer = document.querySelector(SELECTORS.LINE_ITEM_DESC);
            if (!quantityContainer) return;

            const modalContainer = document.querySelector(SELECTORS.ADJUST_QUANTITY_MODAL);

            // 点击数量框打开弹窗
            if (quantityContainer && !utils.isElementVisible(modalContainer)) {
                const hitBox = quantityContainer.querySelector(SELECTORS.QUANTITY_HITBOX);
                if (!this.checkQuantity(quantityContainer)) {
                    console.log('[MWI购买牛铃] 点击数量框');
                    utils.randomClickElement(hitBox);
                    await utils.sleep(CONFIG.PAYMENT_DELAY);
                }
            }

            // 修改数量为99
            if (utils.isElementVisible(modalContainer)) {
                const input = modalContainer.querySelector(SELECTORS.ADJUST_QUANTITY_INPUT);
                console.log('[MWI购买牛铃] 修复数量为99');
                utils.inputSetValue(input, '99');
                await utils.sleep(CONFIG.PAYMENT_DELAY);

                // 点击更新按钮
                const updateBtn = modalContainer.querySelector(SELECTORS.ADJUST_QUANTITY_FOOTER_BTN);
                utils.randomClickElement(updateBtn);
                await utils.sleep(CONFIG.PAYMENT_DELAY);

                // 关闭弹窗
                const closeBtn = modalContainer.querySelector(SELECTORS.ADJUST_QUANTITY_CLOSE_BTN);
                utils.randomClickElement(closeBtn);
                await utils.sleep(CONFIG.PAYMENT_DELAY);
            }

            // 提交支付
            const submitButton = document?.querySelector(SELECTORS.CONFIRM_PAYMENT_BTN);
            if (submitButton && !utils.isElementVisible(modalContainer) && this.checkQuantity(quantityContainer)) {
                const text = submitButton.querySelector(SELECTORS.SUBMIT_BUTTON_TEXT)?.textContent.trim();
                if (text === '支付') {
                    utils.randomClickElement(submitButton);
                }
            }
        },
    };

    // ==================== WebSocket Hook ====================
    function hookWebSocket() {
        // Hook MessageEvent.data 获取 WebSocket 实例
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

        // 拦截 WebSocket，移除 isAuto 字段
        const OriginalWebSocket = window.WebSocket;

        function InterceptedWebSocket(...args) {
            const [url] = args;
            const wsInstance = new OriginalWebSocket(...args);
            const originalSend = wsInstance.send;

            wsInstance.send = function (data) {
                try {
                    const parsed = JSON.parse(data);
                    if ('isAuto' in parsed) {
                        delete parsed.isAuto;
                        originalSend.call(wsInstance, JSON.stringify(parsed));
                        return;
                    }
                } catch (e) {
                    // 解析失败，忽略
                }
                return originalSend.call(this, data);
            };

            return wsInstance;
        }

        InterceptedWebSocket.prototype = OriginalWebSocket.prototype;
        InterceptedWebSocket.OPEN = OriginalWebSocket.OPEN;
        InterceptedWebSocket.CONNECTING = OriginalWebSocket.CONNECTING;
        InterceptedWebSocket.CLOSING = OriginalWebSocket.CLOSING;
        InterceptedWebSocket.CLOSED = OriginalWebSocket.CLOSED;

        window.WebSocket = InterceptedWebSocket;
    }

    // ==================== 主逻辑 ====================
    const host = window.location.host;

    if (host.includes('milkywayidle.com') || host.includes('milkywayidlecn.com')) {
        // 牛铃商店页面逻辑
        hookWebSocket();

        window.addEventListener('DOMContentLoaded', () => {
            const mwiObserver = new MutationObserver(() => {
                const buyCowbellsTab = document.querySelector(SELECTORS.BUY_COWBELLS_TAB);
                if (!buyCowbellsTab) {
                    return;
                }
                mwiComponents.init(buyCowbellsTab);
            });

            mwiObserver.observe(document.body, { childList: true, subtree: true });
            window.addEventListener('beforeunload', () => mwiObserver.disconnect());
        });

        window.addEventListener('load', () => {
            utils.sleepRandom().then(() => {
                const paymentSuccess = document.querySelector(SELECTORS.PAYMENT_SUCCESS_PAGE);
                if (paymentSuccess) {
                    window.close();
                }
            });
        });
    } else if (host.includes('checkout.stripe.com')) {
        // Stripe 支付页面逻辑
        window.addEventListener('load', () => {
            paymentComponents.scanId = window.setInterval(() => {
                if (parseInt(GM_getValue(GM_KEYS.TASK_STATUS) || 0) > 0) {
                    if (!paymentComponents.execId) {
                        paymentComponents.execId = setTimeout(async () => {
                            await paymentComponents.autoPayment();
                            paymentComponents.execId = null;
                        }, 100);
                    }
                }
            }, CONFIG.PAYMENT_CHECK_INTERVAL);

            window.addEventListener('beforeunload', () => {
                window.clearInterval(paymentComponents.scanId);
                if (paymentComponents.execId) {
                    window.clearTimeout(paymentComponents.execId);
                }
            });
        });
    }

    console.log('🎯 [银河奶牛]购买牛铃（测试服专用） 脚本已加载');
})(unsafeWindow);
