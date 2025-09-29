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
    // 處理現有的 SVG
    processExistingSvgs();

    // 設置 MutationObserver 來監聽動態添加的 SVG
    setupSvgObserver();

    console.log('SVG icons initialized');
    console.log('Available icons:', window.svgHelper?.getAvailableIcons() || []);
  }

  // 處理現有的 SVG 使用
  function processExistingSvgs() {
    const existingSvgs = document.querySelectorAll('svg use[xlink\\:href]');
    existingSvgs.forEach(use => {
      const href = use.getAttributeNS('http://www.w3.org/1999/xlink', 'href');
      if (href && href.startsWith('css/symbol-defs.svg#')) {
        // 更新 href 為只包含 fragment identifier
        const iconId = href.replace('css/symbol-defs.svg#', '#');
        use.setAttributeNS('http://www.w3.org/1999/xlink', 'href', iconId);
        //console.log('🔧 Updated SVG path:', href, '->', iconId);
      }
    });
  }

  // 設置 MutationObserver 監聽動態 SVG
  function setupSvgObserver() {
    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        mutation.addedNodes.forEach((node) => {
          if (node.nodeType === 1) { // Element node
            //console.log('🔍 新增節點:', node.tagName, node.className);

            // 檢查新添加的節點是否包含 SVG (更寬鬆的選擇器)
            const newSvgs = node.querySelectorAll ?
              node.querySelectorAll('use[*|href*="css/symbol-defs.svg"], use[href*="css/symbol-defs.svg"]') : [];

            // 如果新節點本身就是 SVG use
            if (node.tagName === 'use') {
              const href = node.getAttributeNS('http://www.w3.org/1999/xlink', 'href') || node.getAttribute('href');
              if (href && href.includes('css/symbol-defs.svg')) {
                const iconId = href.replace('css/symbol-defs.svg#', '#');
                node.setAttributeNS('http://www.w3.org/1999/xlink', 'href', iconId);
                //console.log('🔧 Dynamic SVG updated (direct):', href, '->', iconId);
              }
            }

            // 如果新節點本身就是 SVG 
            if (node.tagName === 'svg') {
              const uses = node.querySelectorAll('use[*|href*="css/symbol-defs.svg"], use[href*="css/symbol-defs.svg"]');
              uses.forEach(use => {
                const href = use.getAttributeNS('http://www.w3.org/1999/xlink', 'href') || use.getAttribute('href');
                if (href && href.includes('css/symbol-defs.svg#')) {
                  const iconId = href.replace('css/symbol-defs.svg#', '#');
                  use.setAttributeNS('http://www.w3.org/1999/xlink', 'href', iconId);
                  //console.log('🔧 Dynamic SVG updated (svg node):', href, '->', iconId);
                }
              });
            }

            // 處理子節點中的 SVG
            newSvgs.forEach(use => {
              const href = use.getAttributeNS('http://www.w3.org/1999/xlink', 'href') || use.getAttribute('href');
              if (href && href.includes('css/symbol-defs.svg#')) {
                const iconId = href.replace('css/symbol-defs.svg#', '#');
                use.setAttributeNS('http://www.w3.org/1999/xlink', 'href', iconId);
                //console.log('🔧 Dynamic SVG updated (child):', href, '->', iconId);
              }
            });

            // 延遲處理 - 以防 AngularJS 還在處理
            setTimeout(() => {
              const delayedSvgs = node.querySelectorAll ?
                node.querySelectorAll('use[*|href*="css/symbol-defs.svg"], use[href*="css/symbol-defs.svg"]') : [];
              delayedSvgs.forEach(use => {
                const href = use.getAttributeNS('http://www.w3.org/1999/xlink', 'href') || use.getAttribute('href');
                if (href && href.includes('css/symbol-defs.svg#')) {
                  const iconId = href.replace('css/symbol-defs.svg#', '#');
                  use.setAttributeNS('http://www.w3.org/1999/xlink', 'href', iconId);
                  //console.log('🔧 Dynamic SVG updated (delayed):', href, '->', iconId);
                }
              });
            }, 100);
          }
        });
      });
    });

    // 開始觀察
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: false,
      attributeOldValue: false,
      characterData: false,
      characterDataOldValue: false
    });

    //console.log('👁️ SVG MutationObserver started');
  }  // 如果 SVG helper 已經載入，直接初始化
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
  //console.log('🔄 Manual SVG update called');
  // 在 AngularJS 視圖更新後調用，確保新添加的 SVG 正確顯示
  setTimeout(() => {
    const existingSvgs = document.querySelectorAll('svg use[xlink\\:href*="css/symbol-defs.svg"]');
    //console.log('🔍 Found SVGs to update:', existingSvgs.length);
    existingSvgs.forEach(use => {
      const href = use.getAttributeNS('http://www.w3.org/1999/xlink', 'href');
      if (href && href.includes('css/symbol-defs.svg#')) {
        const iconId = href.replace('css/symbol-defs.svg#', '#');
        use.setAttributeNS('http://www.w3.org/1999/xlink', 'href', iconId);
        //console.log('🔧 Manual update:', href, '->', iconId);
      }
    });
  }, 100);
};
