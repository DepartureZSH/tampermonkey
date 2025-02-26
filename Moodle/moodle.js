// ==UserScript==
// @name         UNNC Moodle Helper
// @namespace    http://tampermonkey.net/
// @version      2.0
// @description  自动嗅探网页下载资源并提供批量下载功能
// @author       Nobody
// @connect      moodle.nottingham.ac.uk
// @match        https://moodle.nottingham.ac.uk/course/*
// @match        https://moodle.nottingham.ac.uk/mod/resource/view.php*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=nottingham.ac.uk
// @grant        GM_xmlhttpRequest
// @grant        GM.cookie
// @grant        GM_download
// ==/UserScript==

(function () {
    'use strict';

    // 配置参数
    const config = {
        scanDelay: 1000,// 延迟检测页面加载完成
        maxConcurrent: 3,// 最大并发请求数
        autoDownload: false// 是否自动下载（可能被浏览器拦截）
    };

    class FileCrawler {
        constructor() {
            this.links = new Set();
            this.queue = [];
            this.processing = 0;
        }

        // 主入口
        async start() {
            await this.waitForPageReady();
            this.collectResourceLinks();
            this.processQueue();
        }

        // 等待页面资源加载完成
        waitForPageReady() {
            return new Promise(resolve => {
                const checkReady = () => {
                    if (document.readyState === 'complete') {
                        resolve();
                    } else {
                        setTimeout(checkReady, config.scanDelay);
                    }
                };
                checkReady();
            });
        }

        // 收集所有资源链接
        collectResourceLinks() {
            const selector = 'a[href*="mod/resource/view.php?id="]';
            document.querySelectorAll(selector).forEach(link => {
                const url = this.cleanUrl(link.href);
                if (!this.links.has(url)) {
                    this.links.add(url);
                    this.queue.push(url);
                }
            });
            console.log(`找到 ${this.queue.length} 个资源链接`);
        }

        // 处理请求队列
        async processQueue() {
            while (this.queue.length > 0 || this.processing > 0) {
                if (this.processing < config.maxConcurrent && this.queue.length > 0) {
                    this.processing++;
                    const url = this.queue.shift();
                    await this.fetchFileLink(url)
                        .catch(console.error)
                        .finally(() => this.processing--);
                } else {
                    await new Promise(resolve => setTimeout(resolve, 500));
                }
            }
        }

        // 获取实际文件链接
        async fetchFileLink(resourceUrl) {
            return new Promise((resolve, reject) => {
                GM_xmlhttpRequest({
                    method: "GET",
                    url: resourceUrl,
                    onload: (response) => {
                        const doc = new DOMParser().parseFromString(response.responseText, 'text/html');
                        const fileLink = this.findDirectFileLink(doc) || this.generateDownloadLink(resourceUrl);

                        if (fileLink) {
                            this.displayLink(fileLink);
                            if (config.autoDownload) {
                                this.triggerDownload(fileLink);
                            }
                            resolve(fileLink);
                        } else {
                            reject('未找到文件链接');
                        }
                    },
                    onerror: reject
                });
            });
        }

        // 解析页面中的直接文件链接
        findDirectFileLink(doc) {
            const candidates = [
                'a[href*="/pluginfile.php/"]'
            ];
            for (let selector of candidates) {
                const link = doc.querySelector(selector);
                if (link) return this.cleanUrl(link.href);
            }
            return null;
        }

        // 生成强制下载链接
        generateDownloadLink(resourceUrl) {
            const url = new URL(resourceUrl);
            url.searchParams.set('redirect', '1');
            return url.toString();
        }

        // 显示可下载链接
        displayLink(url) {
            const fileName = decodeURIComponent(url.split('/').pop());
            populateList([{ name: fileName, url: url , onclick: ""}]);
        }

        // 清理URL参数
        cleanUrl(rawUrl) {
            const url = new URL(rawUrl);
            url.hash = '';
            url.searchParams.delete('redirect');
            return url.toString();
        }
    }

    // 悬浮窗管理器
    const popupManager = {
        isMinimized: false,
        isDragging: false,
        startX: 0,
        startY: 0,
        offsetX: 0,
        offsetY: 0,

        createPopup() {
            const popup = document.createElement('div');
            popup.id = 'download-helper';
            const tableHTML = `
                <div style="flex:1; overflow:auto; display:block;" id="tableWrapper">
                    <p>请注意：
                    <p>1.某些链接需要解析片刻，才能显示在下载器中。
                    <p>2.由于某些文件下载出错（如.ipynb等后缀名受到服务器限制，无法直接下载），在本下载器中会转.txt格式，请在本地进行删除多余后缀，更改后缀名的操作。
                    <table style="table-layout: fixed; width:100%;">
                        <colgroup>
                            <col style="width:5%">
                            <col style="width:35%">
                            <col style="width:50%">
                            <col style="width:10%">
                        </colgroup>
                        <thead style="position:sticky; top:0; background:#eee; z-index:1;">
                            <tr>
                                <th style="padding:8px;"></th>
                                <th style="padding:8px;">文件名</th>
                                <th style="padding:8px;">下载链接</th>
                                <th style="padding:8px;">操作</th>
                            </tr>
                        </thead>
                        <tbody id="downloadList" style="display:table-row-group;"></tbody>
                    </table>
                </div>
            `;

            // 调整悬浮窗样式
            popup.style = `
                position: fixed;
                right: 20px;
                bottom: 20px;
                z-index: 9999;
                background: white;
                border: 1px solid #ccc;
                border-radius: 5px;
                box-shadow: 0 2px 10px rgba(0,0,0,0.2);
                width: 800px;
                height: 600px;
                display: flex;
                flex-direction: column;
                transition: all 0.3s ease;
            `;

            // 新版控制栏
            const controls = `
                <div id="controls" style="
                    padding:10px;
                    background:#f5f5f5;
                    border-bottom:1px solid #ddd;
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    cursor: move;
                ">
                    <div style="align-items:center;">
                        <label style="cursor: pointer;">
                            <input type="checkbox" id="selectAll"> 全选
                        </label>
                        <button id="downloadBtn" style="margin-left:15px;">下载全部</button>
                    </div>
                    <div>
                        <button id="minimizeBtn" style="margin-right:8px;">−</button>
                    </div>
                </div>
            `;

            // 修改此处，移除条件判断
            popup.innerHTML = controls + tableHTML; // 直接使用固定表格结构
            document.body.appendChild(popup);
            // 事件绑定
            this.bindEvents(popup);
        },

        // 绑定所有交互事件
        bindEvents(popup) {
            const header = popup.querySelector('#controls');

            // 最小化按钮
            popup.querySelector('#minimizeBtn').addEventListener('click', () => {
                this.toggleMinimize(popup);
            });

            // 鼠标事件
            header.addEventListener('mousedown', (e) => {
                if (e.target.tagName === 'BUTTON') return; // 排除按钮点击
                this.startDragging(popup, e);
            });

            document.addEventListener('mousemove', (e) => this.onDragging(popup, e));
            document.addEventListener('mouseup', () => this.stopDragging());
        },


        // 修改popupManager中的toggleMinimize方法
        toggleMinimize(popup) {
            this.isMinimized = !this.isMinimized;
            const btn = popup.querySelector('#minimizeBtn');
            const tableWrapper = popup.querySelector('div'); // 表格容器

            if (this.isMinimized) {
                // 最小化时保持控制栏可见
                popup.style.height = '50px';// 控制栏高度+边距
                popup.style.width = '300px';
                tableWrapper.style.display = 'none';// 仅隐藏表格区域
                btn.textContent = '+';
                // 保持按钮可见
                popup.querySelector('#controls').style.display = 'flex';
            } else {
                popup.style.height = '600px';
                popup.style.width = '800px';
                tableWrapper.style.display = 'block';
                btn.textContent = '−';
                popup.querySelector('#controls').style.display = 'flex';
            }
        },

        // 开始拖拽
        startDragging(popup, e) {
            this.isDragging = true;
            const rect = popup.getBoundingClientRect();
            this.offsetX = e.clientX - rect.left;
            this.offsetY = e.clientY - rect.top;

            popup.style.transition = 'none'; // 拖拽时禁用过渡动画
            document.body.style.userSelect = 'none'; // 防止文字选中
        },

        // 拖拽中
        onDragging(popup, e) {
            if (!this.isDragging) return;

            const x = e.clientX - this.offsetX;
            const y = e.clientY - this.offsetY;

            popup.style.left = `${x}px`;
            popup.style.top = `${y}px`;
            popup.style.right = 'auto';
            popup.style.bottom = 'auto';
        },

        // 停止拖拽
        stopDragging() {
            if (!this.isDragging) return;
            this.isDragging = false;

            const popup = document.getElementById('download-helper');
            popup.style.transition = 'all 0.3s ease';
            document.body.style.userSelect = '';
        }
    };

    // 新增：解析资源页面的真实下载链接
    const parseResourcePage = async (url) => {
        return new Promise((resolve) => {
            GM_xmlhttpRequest({
                method: "HEAD",
                url: url,
                redirect: "follow",
                onload: function(response) {
                    resolve(response.finalUrl || url);
                },
                onerror: () => resolve(null)
            });
        });
    };

    // 修改后的findDownloads函数
    const findDownloads = async () => {
        const links = document.querySelectorAll('a');
        const downloadLinks = [];

        for (const link of links) {
            const href = link.href;

            // 类型1：直接文件链接
            if (href.includes("pluginfile.php")) {
                console.log("类型1", href);
                const fileName = decodeURIComponent(href.split('/').pop());
                downloadLinks.push({ name: fileName, url: href , onclick: ""});
            }
        }

        return downloadLinks;
    };

    // 填充下载列表
    const populateList = (data) => {
        const tbody = document.getElementById('downloadList');
        tbody.innerHTML += data.map((item, index) => `
            <tr>
                <td style="text-align:center;padding:8px;">
                    <input type="checkbox" class="download-checkbox">
                </td>
                <td style="padding:8px;max-width:200px;overflow:hidden;text-overflow:ellipsis;">${item.name}</td>
                <td style="padding:8px;max-width:400px;overflow:hidden;text-overflow:ellipsis;">
                    <a href="${item.url}" target="_blank" onclick="${item.onclick}">${item.url}</a>
                </td>
                <td style="text-align:center;padding:8px;">
                    <a href="${item.url}" target="_blank" title="" onclick="${item.onclick}">Download</a>
                </td>
            </tr>
        `).join('');
    };

    // 初始化脚本
    const init = async () => {
        // 移除旧悬浮窗
        const oldPopup = document.getElementById('download-helper');
        if (oldPopup) oldPopup.remove();

        // 先创建悬浮窗再获取下载链接
        popupManager.createPopup();

        // 使用异步获取下载链接
        setTimeout(async () => {
            const downloads = await findDownloads();
            populateList(downloads);
        }, 0);

        setTimeout(() => new FileCrawler().start(), 2000);

        // 全选功能
        document.getElementById('selectAll').addEventListener('change', (e) => {
            const checkboxes = document.querySelectorAll('.download-checkbox');
            checkboxes.forEach(checkbox => {
                checkbox.checked = e.target.checked;
            });
        });

        // 批量下载
        document.getElementById('downloadBtn').addEventListener('click', async (e) => {
            const selected = document.querySelectorAll('.download-checkbox:checked');
            selected.forEach(checkbox => {
                const link = checkbox.closest('tr').querySelector('a');
                const url = link.href;
                console.log('下载 ', url);
                try {
                    GM_download({
                        url: url,
                        name: decodeURIComponent(url.split('/').pop()),
                        saveAs: false,
                        onerror: (err) => {
                            console.error('下载失败:', err);
                            GM_download({
                                url: url,
                                name: decodeURIComponent(url.split('/').pop()) + '.txt',
                                saveAs: true,
                                onerror: (err) => console.error('下载失败2:', err)
                            });
                        }
                    });
                } catch (e) {
                    console.error('下载异常:', e);
                }
            });
        });

    };

    // 等待DOM加载
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();