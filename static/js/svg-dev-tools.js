/**
 * SVG 開發工具 - 簡化版本，專為開發階段設計
 */
(function () {
    'use strict';

    // 配置
    const CONFIG = {
        svgPath: '/css/symbol-defs.svg',
        containerId: 'svg-defs-container',
        autoReload: true,
        reloadInterval: 5000 // 5秒檢查一次更新（可選）
    };

    let lastModified = null;
    let reloadTimer = null;

    /**
     * 載入 SVG 符號
     */
    async function loadSVGSymbols(force = false) {
        try {
            // 生成防快取 URL
            const timestamp = force ? Date.now() : '';
            const url = `${CONFIG.svgPath}?t=${timestamp}`;

            const response = await fetch(url);

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }

            // 檢查是否有更新
            const currentModified = response.headers.get('last-modified');
            if (!force && currentModified === lastModified) {
                return false; // 沒有更新
            }

            lastModified = currentModified;
            const svgContent = await response.text();

            // 插入或更新 SVG 容器
            insertSVGContainer(svgContent);

            console.log('🎨 SVG symbols reloaded at', new Date().toLocaleTimeString());
            return true;

        } catch (error) {
            console.error('❌ Failed to load SVG symbols:', error);
            return false;
        }
    }

    /**
     * 插入 SVG 容器到頁面
     */
    function insertSVGContainer(svgContent) {
        // 移除舊容器
        const oldContainer = document.getElementById(CONFIG.containerId);
        if (oldContainer) {
            oldContainer.remove();
        }

        // 創建新容器
        const container = document.createElement('div');
        container.id = CONFIG.containerId;
        container.style.display = 'none';
        container.innerHTML = svgContent;

        // 插入到 body 開頭
        document.body.insertBefore(container, document.body.firstChild);
    }

    /**
     * 手動重載 SVG
     */
    function reloadSVG() {
        console.log('🔄 手動重載 SVG...');
        return loadSVGSymbols(true);
    }

    /**
     * 檢查 SVG 圖示是否存在
     */
    function checkIconExists(iconId) {
        const container = document.getElementById(CONFIG.containerId);
        if (!container) {
            console.warn('⚠️ SVG 容器不存在');
            return false;
        }

        const symbol = container.querySelector(`symbol[id="${iconId}"]`);
        const exists = !!symbol;
        console.log(`🔍 檢查圖示 "${iconId}": ${exists ? '✅ 存在' : '❌ 不存在'}`);

        if (!exists) {
            // 列出所有可用的圖示
            const allSymbols = container.querySelectorAll('symbol[id]');
            const availableIcons = Array.from(allSymbols).map(s => s.id);
            console.log('📋 可用圖示:', availableIcons.slice(0, 10), availableIcons.length > 10 ? `... 共 ${availableIcons.length} 個` : '');
        }

        return exists;
    }

    /**
     * 啟動自動檢查更新（可選）
     */
    function startAutoReload() {
        if (reloadTimer) {
            clearInterval(reloadTimer);
        }

        reloadTimer = setInterval(() => {
            loadSVGSymbols(false);
        }, CONFIG.reloadInterval);

        console.log(`🔄 SVG auto-reload enabled (every ${CONFIG.reloadInterval / 1000}s)`);
    }

    /**
     * 停止自動檢查
     */
    function stopAutoReload() {
        if (reloadTimer) {
            clearInterval(reloadTimer);
            reloadTimer = null;
            console.log('⏹️ SVG auto-reload disabled');
        }
    }

    // 初始化
    function init() {
        // 首次載入
        loadSVGSymbols(true).then(() => {
            // 延遲檢查常用圖示
            setTimeout(() => {
                console.log('🔍 檢查常用圖示是否存在:');
                checkIconExists('icon-thumbs-up');
                checkIconExists('icon-investment');
                checkIconExists('icon-eye-plus');
                checkIconExists('icon-spinner9');
            }, 500);
        });

        // 如果啟用自動重載
        if (CONFIG.autoReload) {
            startAutoReload();
        }

        // 暴露到全域
        window.reloadSVG = reloadSVG;
        window.checkIconExists = checkIconExists;
        window.startSVGAutoReload = startAutoReload;
        window.stopSVGAutoReload = stopAutoReload;

        // 添加鍵盤快捷鍵 (Ctrl+Shift+S 重載 SVG)
        document.addEventListener('keydown', (e) => {
            if (e.ctrlKey && e.shiftKey && e.key === 'S') {
                e.preventDefault();
                reloadSVG();
            }
        });

        console.log('🚀 SVG Dev Tools loaded. Commands:');
        console.log('  - reloadSVG() - 手動重載 SVG');
        console.log('  - startSVGAutoReload() - 啟動自動重載');
        console.log('  - stopSVGAutoReload() - 停止自動重載');
        console.log('  - Ctrl+Shift+S - 快捷鍵重載');
    }

    // DOM 準備好後初始化
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

})();
