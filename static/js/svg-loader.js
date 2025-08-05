/**
 * SVG Symbol Loader - 動態載入 SVG 符號定義並解決快取問題
 * 用於開發階段頻繁更新 SVG 的情況
 */
class SVGSymbolLoader {
    constructor(options = {}) {
        this.svgPath = options.svgPath || '/css/symbol-defs.svg';
        this.containerId = options.containerId || 'svg-symbols-container';
        this.enableCache = options.enableCache !== false; // 預設啟用快取，但可關閉
        this.debugMode = options.debugMode || false;
        this.loadedSymbols = new Set();
        this.svgContainer = null;

        this.init();
    }

    /**
     * 初始化 SVG 載入器
     */
    init() {
        // 等待 DOM 載入完成
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', () => this.loadSVGSymbols());
        } else {
            this.loadSVGSymbols();
        }
    }

    /**
     * 載入 SVG 符號定義
     */
    async loadSVGSymbols() {
        try {
            // 創建或獲取 SVG 容器
            this.createSVGContainer();

            // 生成帶時間戳的 URL 避免快取
            const url = this.generateSVGUrl();

            if (this.debugMode) {
                console.log('Loading SVG symbols from:', url);
            }

            // 載入 SVG 內容
            const response = await fetch(url);

            if (!response.ok) {
                throw new Error(`Failed to load SVG: ${response.status} ${response.statusText}`);
            }

            const svgText = await response.text();

            // 解析並插入 SVG 內容
            this.insertSVGContent(svgText);

            if (this.debugMode) {
                console.log('SVG symbols loaded successfully');
            }

            // 觸發自定義事件通知載入完成
            this.dispatchLoadEvent();

        } catch (error) {
            console.error('Error loading SVG symbols:', error);

            // 觸發錯誤事件
            this.dispatchErrorEvent(error);
        }
    }

    /**
     * 生成帶時間戳或版本號的 SVG URL
     */
    generateSVGUrl() {
        const url = new URL(this.svgPath, window.location.origin);

        if (!this.enableCache) {
            // 開發模式：使用時間戳避免快取
            url.searchParams.set('t', Date.now().toString());
        } else {
            // 生產模式：可以使用版本號
            const version = this.getVersionHash();
            if (version) {
                url.searchParams.set('v', version);
            }
        }

        return url.toString();
    }

    /**
     * 獲取版本雜湊（可以從 meta 標籤或其他地方獲取）
     */
    getVersionHash() {
        const metaVersion = document.querySelector('meta[name="svg-version"]');
        return metaVersion ? metaVersion.content : null;
    }

    /**
     * 創建隱藏的 SVG 容器
     */
    createSVGContainer() {
        let container = document.getElementById(this.containerId);

        if (!container) {
            container = document.createElement('div');
            container.id = this.containerId;
            container.style.display = 'none';
            container.setAttribute('aria-hidden', 'true');

            // 插入到 body 開頭
            document.body.insertBefore(container, document.body.firstChild);
        }

        this.svgContainer = container;
    }

    /**
     * 插入 SVG 內容到頁面
     */
    insertSVGContent(svgText) {
        // 創建臨時容器解析 SVG
        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = svgText;

        // 查找 SVG 元素
        const svgElement = tempDiv.querySelector('svg');

        if (svgElement) {
            // 設置 SVG 屬性
            svgElement.style.display = 'none';
            svgElement.setAttribute('aria-hidden', 'true');

            // 清空容器並插入新的 SVG
            this.svgContainer.innerHTML = '';
            this.svgContainer.appendChild(svgElement);

            // 記錄載入的符號
            this.recordLoadedSymbols(svgElement);
        } else {
            throw new Error('No SVG element found in the loaded content');
        }
    }

    /**
     * 記錄已載入的符號
     */
    recordLoadedSymbols(svgElement) {
        const symbols = svgElement.querySelectorAll('symbol[id]');
        this.loadedSymbols.clear();

        symbols.forEach(symbol => {
            this.loadedSymbols.add(symbol.id);
        });

        if (this.debugMode) {
            console.log('Loaded symbols:', Array.from(this.loadedSymbols));
        }
    }

    /**
     * 檢查符號是否已載入
     */
    isSymbolLoaded(symbolId) {
        return this.loadedSymbols.has(symbolId);
    }

    /**
     * 重新載入 SVG 符號（用於開發階段手動刷新）
     */
    async reload() {
        if (this.debugMode) {
            console.log('Reloading SVG symbols...');
        }

        await this.loadSVGSymbols();
    }

    /**
     * 觸發載入完成事件
     */
    dispatchLoadEvent() {
        const event = new CustomEvent('svgSymbolsLoaded', {
            detail: {
                symbolsCount: this.loadedSymbols.size,
                symbols: Array.from(this.loadedSymbols)
            }
        });

        document.dispatchEvent(event);
    }

    /**
     * 觸發錯誤事件
     */
    dispatchErrorEvent(error) {
        const event = new CustomEvent('svgSymbolsError', {
            detail: { error }
        });

        document.dispatchEvent(event);
    }

    /**
     * 獲取所有已載入的符號列表
     */
    getLoadedSymbols() {
        return Array.from(this.loadedSymbols);
    }
}

// 創建全域實例
window.SVGLoader = new SVGSymbolLoader({
    svgPath: '/css/symbol-defs.svg',
    enableCache: false, // 開發模式關閉快取
    debugMode: true     // 開發模式啟用除錯
});

// 提供便利方法
window.reloadSVG = () => window.SVGLoader.reload();

// 在控制台顯示可用指令
console.log('SVG Symbol Loader initialized. Use reloadSVG() to refresh symbols.');

// 監聽載入事件（可選）
document.addEventListener('svgSymbolsLoaded', (event) => {
    console.log(`✓ SVG symbols loaded: ${event.detail.symbolsCount} symbols`);
});

document.addEventListener('svgSymbolsError', (event) => {
    console.error('✗ SVG symbols failed to load:', event.detail.error);
});
