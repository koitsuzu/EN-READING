// 當擴充套件安裝或更新時，建立右鍵選單
chrome.runtime.onInstalled.addListener(() => {
    chrome.contextMenus.create({
        id: "sendToEnReading",
        title: "翻譯與分析選取文字",
        contexts: ["selection"]
    });

    chrome.contextMenus.create({
        id: "sendFullPageToEnReading",
        title: "抓取全文並生成文章",
        contexts: ["page"]
    });
});

// 監聽右鍵選單點擊事件
chrome.contextMenus.onClicked.addListener((info, tab) => {
    if (info.menuItemId === "sendToEnReading") {
        const selectedText = info.selectionText;
        chrome.storage.local.set({ selectedText: selectedText }, () => {
            chrome.sidePanel.open({ windowId: tab.windowId });
        });
    }

    if (info.menuItemId === "sendFullPageToEnReading") {
        // 立即開啟側邊欄避開 user gesture 限制
        chrome.sidePanel.open({ windowId: tab.windowId });

        // 同時進行非同步抓取
        chrome.scripting.executeScript({
            target: { tabId: tab.id },
            function: extractMainContent
        }, (results) => {
            if (results && results[0].result) {
                const fullContent = results[0].result;
                chrome.storage.local.set({ capturedFullPage: fullContent }, () => {
                    // 發送通知
                    chrome.notifications.create({
                        type: 'basic',
                        iconUrl: 'icon.png',
                        title: '全文擷取成功！',
                        message: '內容已放入側邊欄並準備匯入主網站。',
                        priority: 2
                    });
                });
            }
        });
    }
});

// 強化版：擷取真正的文章本文
function extractMainContent() {
    // 試圖尋找常見的文章主體標籤
    const selectors = ['article', 'main', '.article-body', '.story-body', '.entry-content', '#main-content'];
    let articleEl = null;

    for (let s of selectors) {
        let el = document.querySelector(s);
        if (el && el.innerText.trim().length > 400) {
            articleEl = el;
            break;
        }
    }

    // 如果找不到特定標籤，尋找段落最多的容器
    if (!articleEl) {
        let maxP = 0;
        document.querySelectorAll('div, section').forEach(el => {
            const pCount = el.querySelectorAll('p').length;
            if (pCount > maxP) {
                maxP = pCount;
                articleEl = el;
            }
        });
    }

    const target = articleEl || document.body;
    const elements = target.querySelectorAll('h1, h2, h3, p');

    // 过滤並組合成文字
    const content = Array.from(elements)
        .map(el => el.innerText.trim())
        .filter(text => text.length > 25)
        .join('\n\n');

    return content.length > 100 ? content : null;
}
