/**
 * SVG Icons 初始化腳本
 * 處理頁面載入時的 SVG 圖標設置
 */

// 等待 DOM 和 SVG Helper 準備就緒
document.addEventListener('DOMContentLoaded', function () {
    // 添加 SVG 圖標的基本樣式
    const style = document.createElement('style');
    style.textContent = `
    .svg-icon {
      display: inline-block;
      vertical-align: middle;
      fill: currentColor;
    }
    
    .icon-sm {
      width: 1em;
      height: 1em;
    }
    
    .icon-md {
      width: 1.5em;
      height: 1.5em;
    }
    
    .icon-lg {
      width: 2em;
      height: 2em;
    }
    
    .icon-xl {
      width: 3em;
      height: 3em;
    }
    
    /* 確保圖標與文字對齊 */
    .btn .svg-icon,
    .navbar .svg-icon {
      margin-right: 0.25rem;
    }
    
    /* SVG sprite 容器隱藏 */
    #svg-sprite-container {
      position: absolute;
      width: 0;
      height: 0;
      overflow: hidden;
      opacity: 0;
      pointer-events: none;
    }
  `;
    document.head.appendChild(style);

    // 等待 SVG sprite 載入完成
    function initializeIcons() {
        // 檢查是否有需要處理的現有 SVG 使用
        const existingSvgs = document.querySelectorAll('svg use[xlink\\:href]');
        existingSvgs.forEach(use => {
            const href = use.getAttributeNS('http://www.w3.org/1999/xlink', 'href');
            if (href && href.startsWith('css/symbol-defs.svg#')) {
                // 更新 href 為只包含 fragment identifier
                const iconId = href.replace('css/symbol-defs.svg#', '#');
                use.setAttributeNS('http://www.w3.org/1999/xlink', 'href', iconId);
            }
        });

        console.log('SVG icons initialized');
        console.log('Available icons:', window.svgHelper?.getAvailableIcons() || []);
    }

    // 如果 SVG helper 已經載入，直接初始化
    if (window.svgHelper?.spriteLoaded) {
        initializeIcons();
    } else {
        // 否則等待 sprite 載入事件
        document.addEventListener('svgSpriteLoaded', initializeIcons);
    }
});

// 提供便利函數給 AngularJS 或其他腳本使用
window.createSvgIcon = function (iconId, size = 'sm') {
    if (!window.svgHelper) {
        console.error('SVG Helper not loaded');
        return null;
    }

    return window.svgHelper.createIcon(iconId, `icon-${size}`);
};

// 為 AngularJS 控制器提供的函數
window.updateSvgIcons = function () {
    // 在 AngularJS 視圖更新後調用，確保新添加的 SVG 正確顯示
    setTimeout(() => {
        const existingSvgs = document.querySelectorAll('svg use[xlink\\:href*="css/symbol-defs.svg"]');
        existingSvgs.forEach(use => {
            const href = use.getAttributeNS('http://www.w3.org/1999/xlink', 'href');
            if (href && href.includes('css/symbol-defs.svg#')) {
                const iconId = href.replace('css/symbol-defs.svg#', '#');
                use.setAttributeNS('http://www.w3.org/1999/xlink', 'href', iconId);
            }
        });
    }, 100);
};
