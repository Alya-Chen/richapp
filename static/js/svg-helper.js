/**
 * SVG Sprite Helper
 * 用於處理 SVG sprite 圖標的顯示和管理
 */
class SvgSpriteHelper {
    constructor() {
        this.spriteLoaded = false;
        this.spriteUrl = '/css/symbol-defs.svg';
        this.loadSprite();
    }

    /**
     * 載入 SVG sprite 到頁面中
     */
    async loadSprite() {
        try {
            // 檢查是否已經載入
            if (document.getElementById('svg-sprite-defs')) {
                this.spriteLoaded = true;
                return;
            }

            // 載入 SVG sprite 內容
            const response = await fetch(this.spriteUrl);
            const svgText = await response.text();

            // 創建一個隱藏的 div 來包含 SVG sprite
            const spriteContainer = document.createElement('div');
            spriteContainer.id = 'svg-sprite-container';
            spriteContainer.style.display = 'none';
            spriteContainer.innerHTML = svgText;

            // 將 sprite 添加到 body 的開頭
            document.body.insertBefore(spriteContainer, document.body.firstChild);

            this.spriteLoaded = true;
            console.log('SVG Sprite loaded successfully');

            // 觸發自定義事件，通知 sprite 已載入
            document.dispatchEvent(new CustomEvent('svgSpriteLoaded'));

        } catch (error) {
            console.error('Failed to load SVG sprite:', error);
        }
    }

    /**
     * 創建 SVG 圖標元素
     * @param {string} iconId - 圖標 ID (例如: 'icon-investment')
     * @param {string} className - CSS 類名
     * @param {Object} attributes - 額外的屬性
     * @returns {SVGElement} SVG 元素
     */
    createIcon(iconId, className = '', attributes = {}) {
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');

        // 設定基本屬性
        svg.setAttribute('fill', 'currentColor');
        svg.setAttribute('class', `svg-icon ${className}`);

        // 設定額外屬性
        Object.keys(attributes).forEach(key => {
            svg.setAttribute(key, attributes[key]);
        });

        // 設定 use 元素
        use.setAttributeNS('http://www.w3.org/1999/xlink', 'xlink:href', `#${iconId}`);

        svg.appendChild(use);
        return svg;
    }

    /**
     * 將 SVG 圖標插入到指定元素中
     * @param {string|Element} target - 目標元素或選擇器
     * @param {string} iconId - 圖標 ID
     * @param {string} className - CSS 類名
     * @param {Object} attributes - 額外的屬性
     */
    insertIcon(target, iconId, className = '', attributes = {}) {
        const targetElement = typeof target === 'string'
            ? document.querySelector(target)
            : target;

        if (!targetElement) {
            console.error('Target element not found:', target);
            return;
        }

        const icon = this.createIcon(iconId, className, attributes);
        targetElement.appendChild(icon);
    }

    /**
     * 替換元素中的內容為 SVG 圖標
     * @param {string|Element} target - 目標元素或選擇器
     * @param {string} iconId - 圖標 ID
     * @param {string} className - CSS 類名
     * @param {Object} attributes - 額外的屬性
     */
    replaceWithIcon(target, iconId, className = '', attributes = {}) {
        const targetElement = typeof target === 'string'
            ? document.querySelector(target)
            : target;

        if (!targetElement) {
            console.error('Target element not found:', target);
            return;
        }

        const icon = this.createIcon(iconId, className, attributes);
        targetElement.innerHTML = '';
        targetElement.appendChild(icon);
    }

    /**
     * 獲取可用的圖標列表
     * @returns {Array} 圖標 ID 列表
     */
    getAvailableIcons() {
        const spriteElement = document.querySelector('#svg-sprite-container svg');
        if (!spriteElement) {
            console.warn('SVG sprite not loaded yet');
            return [];
        }

        const symbols = spriteElement.querySelectorAll('symbol');
        return Array.from(symbols).map(symbol => symbol.id);
    }

    /**
     * 檢查圖標是否存在
     * @param {string} iconId - 圖標 ID
     * @returns {boolean} 是否存在
     */
    hasIcon(iconId) {
        return this.getAvailableIcons().includes(iconId);
    }
}

// 創建全局實例
window.svgHelper = new SvgSpriteHelper();

// 提供簡便的全局函數
window.addSvgIcon = function (target, iconId, className = '', attributes = {}) {
    window.svgHelper.insertIcon(target, iconId, className, attributes);
};

window.replaceSvgIcon = function (target, iconId, className = '', attributes = {}) {
    window.svgHelper.replaceWithIcon(target, iconId, className, attributes);
};

// DOM 載入完成後的初始化
document.addEventListener('DOMContentLoaded', function () {
    // 確保 sprite 已載入
    if (!window.svgHelper.spriteLoaded) {
        document.addEventListener('svgSpriteLoaded', function () {
            console.log('Available SVG icons:', window.svgHelper.getAvailableIcons());
        });
    }
});

// 如果需要作為模組使用，可以取消註解下面這行
// export { SvgSpriteHelper };