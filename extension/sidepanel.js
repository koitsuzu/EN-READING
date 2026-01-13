// Configuration
let API_KEY = "";
const GENAI_MODEL = "gemini-2.5-flash"; // 使用最新 2.5 版本

// State Management (Sync with chrome.storage)
let state = {
    vocabulary: [],
    currentVocab: [],
    activeTab: 'current',
    readingHistory: {},
    currentArticle: null,
    currentQuiz: null,
    streak: 0
};

// DOM Elements (Lazy Fetch to prevent null errors)
const getEl = (id) => document.getElementById(id);
const elements = {
    get statusDisplay() { return getEl('status-display'); },
    get articleSection() { return getEl('article-section'); },
    get articleContent() { return getEl('article-content'); },
    get vocabItems() { return getEl('vocab-items'); },
    get streakDisplay() { return getEl('streak-display'); },
    get totalReadingDisplay() { return getEl('total-reading-display'); },
    get startQuizBtn() { return getEl('start-quiz-btn'); },
    get quizModal() { return getEl('quiz-modal'); },
    get quizContainer() { return getEl('quiz-container'); },
    get wordTooltip() { return getEl('word-tooltip'); },
    get voiceSelect() { return getEl('voice-select'); },
    get pauseBtn() { return getEl('tts-pause-btn'); },
    get ttsBtn() { return getEl('tts-article-btn'); },
    // Settings
    get settingsBtn() { return getEl('settings-btn'); },
    get settingsModal() { return getEl('settings-modal'); },
    get apiKeyInput() { return getEl('api-key-input'); },
    get saveKeyBtn() { return getEl('save-key-btn'); },
    get closeSettingsBtn() { return getEl('close-settings-btn'); },
    get showKeyToggle() { return getEl('show-key-toggle'); },
    get testKeyBtn() { return getEl('test-key-btn'); },
    get apiStatusMsg() { return getEl('api-status-msg'); }
};

// Initialize
async function init() {
    // 優先從 chrome.storage 載入
    chrome.storage.local.get(['vibe_api_key', 'vibe_vocab', 'vibe_reading'], (result) => {
        API_KEY = result.vibe_api_key || "";
        state.vocabulary = result.vibe_vocab || [];
        state.readingHistory = result.vibe_reading || {};

        if (elements.apiKeyInput) {
            elements.apiKeyInput.value = API_KEY;
        }

        renderVocabulary();
        updateStreak();
        setupEventListeners();

        // 檢查是否有待處理的文字或全文
        chrome.storage.local.get(['selectedText', 'capturedFullPage'], (res) => {
            if (res.selectedText) {
                processText(res.selectedText);
                chrome.storage.local.remove('selectedText');
            } else if (res.capturedFullPage) {
                processText(res.capturedFullPage);
                // 注意：不刪除 capturedFullPage，讓主網站也能偵測到
            }
        });

        if (!API_KEY) openSettings();
    });

    // 監聽未來的變化
    chrome.storage.onChanged.addListener((changes, area) => {
        if (area === 'local') {
            if (changes.selectedText) {
                processText(changes.selectedText.newValue);
                chrome.storage.local.remove('selectedText');
            } else if (changes.capturedFullPage) {
                processText(changes.capturedFullPage.newValue);
            }

            // 同步單字與閱讀紀錄
            if (changes.vibe_vocab) {
                state.vocabulary = changes.vibe_vocab.newValue || [];
                renderVocabulary();
            }
            if (changes.vibe_reading) {
                state.readingHistory = changes.vibe_reading.newValue || {};
                updateStreak();
            }
        }
    });
}

// Core Logic: Process selected text
async function processText(text) {
    if (!text) return;

    elements.statusDisplay.style.display = 'none';
    elements.articleSection.style.display = 'block';
    elements.articleContent.innerHTML = "<div class='spinner'>AI 正在分析內容並生成測驗...</div>";
    state.currentVocab = [];

    // 限制處理的文章長度，避免過長導致 AI 生成緩慢 (約前 2000 字)
    const truncatedText = text.length > 5000 ? text.substring(0, 5000) + "..." : text;
    state.currentArticle = { content: truncatedText };

    renderArticle(truncatedText);

    if (!API_KEY) {
        elements.articleContent.innerHTML += "<p style='color:var(--primary); margin-top:1rem;'>請先設定 API Key 才能生成測驗。</p>";
        return;
    }

    await generateQuiz(text);
}

// AI Integration
async function callGemini(prompt, customKey = null) {
    const keyToUse = customKey || API_KEY;
    if (!keyToUse) return { error: "尚未設定 API Key" };

    try {
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${GENAI_MODEL}:generateContent?key=${keyToUse}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{ parts: [{ text: prompt }] }],
                generationConfig: {
                    responseMimeType: "application/json",
                    temperature: 0.7,
                    maxOutputTokens: 1500,
                    topP: 0.95
                }
            })
        });

        const data = await response.json();

        if (!response.ok) {
            const errorMsg = data.error ? `${data.error.status}: ${data.error.message}` : `HTTP Error ${response.status}`;
            throw new Error(errorMsg);
        }

        const text = data.candidates[0].content.parts[0].text;
        return { data: JSON.parse(text) };
    } catch (error) {
        console.error("Gemini API Error:", error);
        return { error: error.message };
    }
}

async function generateQuiz(content) {
    // 精簡提示詞以加快推理速度
    const prompt = `Task: Generate 3 English comprehension MCQs for text: "${content.substring(0, 1500)}".
    Requirement: Questions/Options in English, Explanation in Traditional Chinese.
    Format: JSON Array [{question, options, answer(int), explanation}]`;

    const result = await callGemini(prompt);
    if (result.data) {
        state.currentQuiz = result.data;
        elements.startQuizBtn.innerText = "開始測驗";
    } else {
        elements.startQuizBtn.innerText = `生成失敗: ${result.error}`;
    }
}

function renderArticle(content) {
    const words = content.split(/\s+/);
    elements.articleContent.innerHTML = words.map(word => {
        const cleanWord = word.replace(/[.,\/#!$%\^&\*;:{}=\-_`~()]/g, "");
        // 移除 onclick，改用 class 與 data-word
        return `<span class="article-word" data-word="${cleanWord}">${word}</span>`;
    }).join(' ');
}

// Word Logic
async function handleWordClick(event, word) {
    if (!word) return;
    event.stopPropagation(); // 防止事件冒泡

    const tooltip = elements.wordTooltip;
    const tooltipWord = getEl('tooltip-word');
    const tooltipDef = getEl('tooltip-def');
    const saveBtn = getEl('save-word-btn');

    if (!tooltip || !tooltipWord || !tooltipDef) {
        console.error("Critical DOM elements for tooltip missing");
        return;
    }

    // 重設狀態，防止殘留
    tooltipWord.innerText = word;
    tooltipDef.innerText = "翻譯中...";
    if (saveBtn) {
        saveBtn.onclick = null;
        saveBtn.style.display = 'none'; // 翻譯完成前先隱藏按鈕
    }

    const rect = event.target.getBoundingClientRect();
    tooltip.style.top = `${rect.bottom + window.scrollY + 10}px`;
    tooltip.style.left = `${Math.max(10, rect.left + window.scrollX - 50)}px`;
    tooltip.style.display = 'block';

    const prompt = `Translate this English word to Traditional Chinese and provide a short English definition: "${word.replace(/"/g, '\\"')}".
    Return JSON: { "translation": "...", "definition": "..." }`;
    const result = await callGemini(prompt);

    if (result.data) {
        const data = result.data;
        tooltipDef.innerText = `${data.translation}\n${data.definition}`;
        if (saveBtn) {
            saveBtn.style.display = 'block';
            saveBtn.onclick = (e) => {
                e.stopPropagation();
                saveWord(word, data.translation, data.definition);
            };
        }
    } else {
        tooltipDef.innerHTML = `翻譯失敗: ${result.error}<br><button class="open-settings-btn" style="font-size:0.7rem; padding:4px; margin-top:5px; background:var(--secondary); color:#1e293b;">檢查 API Key</button>`;
    }
}

function saveWord(word, translation, definition) {
    const wordObj = { word, translation, definition };

    // 檢查是否已存在，不重複存儲 (忽略大小寫)
    const existsInCurrent = state.currentVocab.some(v => v.word.toLowerCase() === word.toLowerCase());
    if (!existsInCurrent) {
        state.currentVocab.unshift(wordObj);
    }

    const existsInGlobal = state.vocabulary.some(v => v.word.toLowerCase() === word.toLowerCase());
    if (!existsInGlobal) {
        state.vocabulary.unshift(wordObj);
        // 強制同步到 chrome.storage.local
        chrome.storage.local.set({ 'vibe_vocab': state.vocabulary }, () => {
            console.log("單字已成功同步至全域儲存空間");
        });
    }

    renderVocabulary();
    elements.wordTooltip.style.display = 'none';
}

function renderVocabulary() {
    const vocabBox = elements.vocabItems;
    if (!vocabBox) return;

    const list = state.activeTab === 'current' ? state.currentVocab : state.vocabulary;
    if (list.length === 0) {
        vocabBox.innerHTML = `<div style="text-align:center; color:var(--text-muted); padding:1rem;">尚無單字</div>`;
        return;
    }

    vocabBox.innerHTML = list.map(v => `
        <div class="vocab-item fade-in">
            <div style="flex: 1;">
                <span class="vocab-word">${v.word}</span>
                <span class="vocab-def">${v.translation}</span>
            </div>
            <button class="vocab-speak-btn" data-word="${v.word.replace(/'/g, "\\'")}" style="background:none; color:var(--text-muted); padding:5px; font-size:0.8rem;">🔊</button>
        </div>
    `).join('');
}

// 全域語音變數
let currentUtterance = null;

function loadVoices() {
    const voices = window.speechSynthesis.getVoices();
    elements.voiceSelect.innerHTML = voices
        .filter(v => v.lang.startsWith('en'))
        .map(v => `<option value="${v.name}">${v.name}</option>`)
        .join('');
}

// 監聽聲音列表變化
window.speechSynthesis.onvoiceschanged = loadVoices;

function speak(text) {
    // 如果正在朗讀，則切換模式
    if (window.speechSynthesis.speaking) {
        if (window.speechSynthesis.paused) {
            window.speechSynthesis.resume();
            elements.pauseBtn.innerText = "⏸";
            return;
        } else {
            window.speechSynthesis.pause();
            elements.pauseBtn.innerText = "▶️";
            return;
        }
    }

    const utterance = new SpeechSynthesisUtterance(text);
    const voices = window.speechSynthesis.getVoices();
    const selectedVoice = voices.find(v => v.name === elements.voiceSelect.value);

    if (selectedVoice) utterance.voice = selectedVoice;
    utterance.lang = 'en-US';
    utterance.rate = 0.9;

    utterance.onstart = () => {
        if (elements.pauseBtn) {
            elements.pauseBtn.style.display = 'block';
            elements.pauseBtn.innerText = "⏸";
        }
        if (elements.ttsBtn) elements.ttsBtn.innerText = "⏹ 停止朗讀";
    };

    utterance.onend = () => {
        if (elements.pauseBtn) elements.pauseBtn.style.display = 'none';
        if (elements.ttsBtn) elements.ttsBtn.innerText = "🔊 全文朗讀";
    };

    currentUtterance = utterance;
    window.speechSynthesis.speak(utterance);
}

// Streak Logics
function updateStreak() {
    const history = state.readingHistory;
    const display = elements.streakDisplay;
    if (!display) return;

    let streak = 0;
    let totalRead = 0;
    let checkDate = new Date();

    // 計算總閱讀量
    Object.values(history).forEach(count => totalRead += count);

    while (true) {
        const key = `${checkDate.getFullYear()}-${checkDate.getMonth() + 1}-${checkDate.getDate()}`;
        if (history[key]) {
            streak++;
            checkDate.setDate(checkDate.getDate() - 1);
        } else {
            break;
        }
    }
    display.innerText = `🔥 ${streak} 天`;
    if (elements.totalReadingDisplay) {
        elements.totalReadingDisplay.innerText = `📚 累積: ${totalRead}`;
    }
}

function recordReading() {
    const now = new Date();
    const key = `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}`;
    state.readingHistory[key] = (state.readingHistory[key] || 0) + 1;
    chrome.storage.local.set({ 'vibe_reading': state.readingHistory });
    updateStreak();
}

// Event Listeners
function setupEventListeners() {
    elements.settingsBtn.onclick = openSettings;
    elements.closeSettingsBtn.onclick = () => elements.settingsModal.style.display = 'none';
    elements.saveKeyBtn.onclick = () => {
        const key = elements.apiKeyInput.value.trim();
        if (!key) return alert("請輸入 API Key");
        API_KEY = key;
        // 同步儲存，並確保不被 content_script 的空值覆蓋
        chrome.storage.local.set({ vibe_api_key: key }, () => {
            localStorage.setItem('vibe_api_key', key);
            elements.settingsModal.style.display = 'none';
            alert("設定成功！");
        });
    };

    elements.testKeyBtn.onclick = async () => {
        const testKey = elements.apiKeyInput.value.trim();
        if (!testKey) return alert("請先輸入 API Key 再測試");

        const msg = elements.apiStatusMsg;
        msg.style.display = 'block';
        msg.style.background = '#f1f5f9';
        msg.innerText = "正在測試連線...";

        const result = await callGemini("Say 'Hello' in JSON: { 'reply': 'Hello' }", testKey);

        if (result.data) {
            msg.style.background = '#dcfce7';
            msg.style.color = '#166534';
            msg.innerText = "✅ 連線成功！API Key 有效。";
        } else {
            msg.style.background = '#fee2e2';
            msg.style.color = '#991b1b';
            msg.innerText = `❌ 連線失敗：${result.error}`;
        }
    };

    elements.showKeyToggle.onchange = (e) => elements.apiKeyInput.type = e.target.checked ? 'text' : 'password';

    elements.startQuizBtn.onclick = () => {
        if (!state.currentQuiz) return alert("測驗生成中，請稍候...");
        renderQuiz();
        elements.quizModal.style.display = 'flex';
    };

    document.getElementById('close-quiz').onclick = () => elements.quizModal.style.display = 'none';

    document.getElementById('submit-quiz').onclick = () => {
        state.currentQuiz.forEach((q, i) => {
            const selected = document.querySelector(`input[name="q${i}"]:checked`);
            const expl = document.getElementById(`expl-${i}`);
            expl.classList.add('visible');

            const correctLabel = document.getElementById(`q${i}-opt${q.answer}`);
            correctLabel.classList.add('correct-answer');

            if (selected && parseInt(selected.value) !== q.answer) {
                const wrongLabel = document.getElementById(`q${i}-opt${selected.value}`);
                wrongLabel.classList.add('wrong-answer');
            }
        });
        recordReading();
        document.getElementById('submit-quiz').style.display = 'none';
    };

    elements.tabCurrent = document.getElementById('tab-current');
    elements.tabAll = document.getElementById('tab-all');

    elements.tabCurrent.onclick = () => {
        state.activeTab = 'current';
        elements.tabCurrent.classList.add('active');
        elements.tabAll.classList.remove('active');
        renderVocabulary();
    };

    elements.tabAll.onclick = () => {
        state.activeTab = 'all';
        elements.tabAll.classList.add('active');
        elements.tabCurrent.classList.remove('active');
        renderVocabulary();
    };

    document.getElementById('tts-article-btn').onclick = () => {
        if (window.speechSynthesis.speaking && !window.speechSynthesis.paused) {
            window.speechSynthesis.cancel();
            elements.ttsBtn.innerText = "🔊 全文朗讀";
            elements.pauseBtn.style.display = 'none';
        } else {
            speak(state.currentArticle.content);
        }
    };

    elements.pauseBtn.onclick = () => {
        if (window.speechSynthesis.paused) {
            window.speechSynthesis.resume();
            elements.pauseBtn.innerText = "⏸";
        } else {
            window.speechSynthesis.pause();
            elements.pauseBtn.innerText = "▶️";
        }
    };

    // 初始化語音列表
    setTimeout(loadVoices, 500);

    // 點擊外部關閉 tooltip
    window.addEventListener('click', (e) => {
        if (elements.wordTooltip && !elements.wordTooltip.contains(e.target) && !elements.articleContent.contains(e.target)) {
            elements.wordTooltip.style.display = 'none';
        }
    });

    // --- 事件委派 (Event Delegation) ---

    // 1. 文章單字點擊
    if (elements.articleContent) {
        elements.articleContent.addEventListener('click', (e) => {
            if (e.target.classList.contains('article-word')) {
                const word = e.target.getAttribute('data-word');
                handleWordClick(e, word);
            }
        });
    }

    // 2. 單字庫語音播放按鈕
    if (elements.vocabItems) {
        elements.vocabItems.addEventListener('click', (e) => {
            const btn = e.target.closest('.vocab-speak-btn');
            if (btn) {
                const word = btn.getAttribute('data-word');
                speak(word);
            }
        });
    }

    // 3. Tooltip 中的設定按鈕
    if (elements.wordTooltip) {
        elements.wordTooltip.addEventListener('click', (e) => {
            if (e.target.classList.contains('open-settings-btn')) {
                openSettings();
            }
        });
    }

    // 重新暴露必要函式到 window 以支援 onclick (保留但不鼓勵，主要提供給動態 HTML 使用)
    window.saveWord = saveWord;
    window.speak = speak;
}

function openSettings() {
    elements.settingsModal.style.display = 'flex';
}

function renderQuiz() {
    elements.quizContainer.innerHTML = state.currentQuiz.map((q, i) => `
        <div class="quiz-item" style="margin-bottom: 1.5rem;">
            <p style="font-weight:700; margin-bottom:0.8rem;">Q${i + 1}: ${q.question}</p>
            <div style="display:flex; flex-direction:column; gap:0.5rem;">
                ${q.options.map((opt, oi) => `
                    <label id="q${i}-opt${oi}" style="display:flex; align-items:center; gap:0.5rem; padding:0.5rem; border:1px solid #e2e8f0; border-radius:8px; cursor:pointer;">
                        <input type="radio" name="q${i}" value="${oi}"> ${opt}
                    </label>
                `).join('')}
            </div>
            <div class="quiz-explanation" id="expl-${i}">
                <p><strong>解析：</strong>${q.explanation}</p>
            </div>
        </div>
    `).join('');
}

// Start
init();
