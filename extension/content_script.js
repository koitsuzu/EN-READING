// 這是一個橋接腳本，會在主網站開啟時運行
// 它負責讓網站的 localStorage 與擴充套件的 chrome.storage 同步

const STORAGE_KEYS = ['vibe_vocab', 'vibe_reading', 'vibe_api_key'];

// 1. 初始化：當網頁開啟，從擴充套件載入最新數據覆蓋本地 (如果擴充套件已有資料)
chrome.storage.local.get(STORAGE_KEYS, (result) => {
    STORAGE_KEYS.forEach(key => {
        if (result[key]) {
            // 如果擴充套件內有資料，寫入網頁的 localStorage
            const value = typeof result[key] === 'string' ? result[key] : JSON.stringify(result[key]);
            localStorage.setItem(key, value);
        }
    });
    // 通知網頁端重新渲染 (如果網頁有監聽的話)
    window.dispatchEvent(new Event('storage'));
});

// 2. 監聽網頁端的變化：當你在網頁存單字，同步回擴充套件
window.addEventListener('storage', (e) => {
    if (STORAGE_KEYS.includes(e.key)) {
        let val = e.newValue;
        // 增加防禦性檢查：防止空 Key 覆疊有效 Key
        if (e.key === 'vibe_api_key' && !val) return;

        try { val = JSON.parse(val); } catch (err) { }
        chrome.storage.local.set({ [e.key]: val });
    }
});

// 3. 監聽擴充套件端的變化：同步回網頁 localStorage (雙向即時同步)
chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local') {
        STORAGE_KEYS.forEach(key => {
            if (changes[key]) {
                const newValue = changes[key].newValue;
                const valueStr = typeof newValue === 'string' ? newValue : JSON.stringify(newValue);
                localStorage.setItem(key, valueStr);
                // 觸發網頁內的重新渲染
                window.dispatchEvent(new Event('storage'));
            }
        });
    }
});

// 3. 定時檢查（可選）：確保同步
setInterval(() => {
    STORAGE_KEYS.forEach(key => {
        let localVal = localStorage.getItem(key);
        if (localVal) {
            try { localVal = JSON.parse(localVal); } catch (err) { }
            chrome.storage.local.get([key], (res) => {
                if (JSON.stringify(res[key]) !== JSON.stringify(localVal)) {
                    chrome.storage.local.set({ [key]: localVal });
                }
            });
        }
    });
}, 5000);

// 4. 偵測是否有從外部抓取的「全文內容」需要處理
function checkMainWebsite() {
    if (!document.body) return;

    // 改用標題或標誌性元素來判斷是否為「您的主網站」
    const isMainWebsite = document.title.includes('Vibe') ||
        (document.body.innerText && document.body.innerText.includes('AI GENERATE READING')) ||
        !!document.getElementById('custom-prompt');

    if (isMainWebsite) {
        chrome.storage.local.get(['capturedFullPage'], (result) => {
            if (result.capturedFullPage) {
                const fullText = result.capturedFullPage;

                const checkExist = setInterval(() => {
                    const promptInput = document.getElementById('custom-prompt');
                    if (promptInput) {
                        clearInterval(checkExist);

                        // 填入內容
                        promptInput.value = fullText;

                        // 視覺反饋
                        promptInput.style.border = "2px solid #ef4444";
                        promptInput.style.backgroundColor = "#fff9f9";

                        alert("✅ 已擷取全文內容！\n請直接點擊「生成文章」按鈕開始練習。");

                        // 清除暫存
                        chrome.storage.local.remove('capturedFullPage');
                    }
                }, 600);
            }
        });
    }
}

// 根據 manifest 的 run_at 設定，保險起見在不同階段嘗試執行
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', checkMainWebsite);
} else {
    checkMainWebsite();
}
