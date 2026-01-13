// Configuration
let API_KEY = localStorage.getItem('vibe_api_key') || "";
const GENAI_MODEL = "gemini-2.5-flash"; // User defined preference

// State Management
let state = {
    vocabulary: JSON.parse(localStorage.getItem('vibe_vocab')) || [],
    currentVocab: [], // Specific to current article
    activeTab: 'all',
    readingHistory: JSON.parse(localStorage.getItem('vibe_reading')) || {},
    currentArticle: null,
    currentQuiz: null,
    streak: 0
};

// DOM Elements (Lazy Fetch to prevent null errors)
const getEl = (id) => document.getElementById(id);
const elements = {
    get generateBtn() { return getEl('generate-btn'); },
    get vocabGenerateBtn() { return getEl('vocab-generate-btn'); },
    get topicSelect() { return getEl('topic-select'); },
    get diffSelect() { return getEl('difficulty-select'); },
    get customPrompt() { return getEl('custom-prompt'); },
    get articleSection() { return getEl('article-section'); },
    get articleContent() { return getEl('article-content'); },
    get articleTitle() { return getEl('article-title'); },
    get vocabItems() { return getEl('vocab-items'); },
    get calendarGrid() { return getEl('calendar-grid'); },
    get monthTotal() { return getEl('month-total'); },
    get currentMonth() { return getEl('current-month'); },
    get streakDisplay() { return getEl('streak-display'); },
    get startQuizBtn() { return getEl('start-quiz-btn'); },
    get quizModal() { return getEl('quiz-modal'); },
    get quizContainer() { return getEl('quiz-container'); },
    get wordTooltip() { return getEl('word-tooltip'); },
    get voiceSelect() { return getEl('voice-select'); },
    get pauseBtn() { return getEl('tts-pause-btn'); },
    // Settings
    get settingsBtn() { return getEl('settings-btn'); },
    get settingsModal() { return getEl('settings-modal'); },
    get apiKeyInput() { return getEl('api-key-input'); },
    get saveKeyBtn() { return getEl('save-key-btn'); },
    get closeSettingsBtn() { return getEl('close-settings-btn'); },
    get showKeyToggle() { return getEl('show-key-toggle'); }
};

// Initialize
function init() {
    renderVocabulary();
    renderCalendar();
    updateStreak();
    setupEventListeners();
    setupSettings();

    if (!API_KEY) {
        openSettings();
    }
}

// AI Integration
async function callGemini(prompt) {
    try {
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${GENAI_MODEL}:generateContent?key=${API_KEY}`, {
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
        let text = data.candidates[0].content.parts[0].text;

        // 清理 JSON 字串：移除 Markdown 標記並去除空格
        text = text.replace(/```json/g, "").replace(/```/g, "").trim();

        try {
            return JSON.parse(text);
        } catch (e) {
            console.error("JSON Parse Error. Cleaned text:", text);
            return null;
        }
    } catch (error) {
        console.error("Gemini API Error:", error);
        if (error.status === 400 || error.message.includes("400")) {
            alert("API Key 無效，請檢查設定。");
            openSettings();
        } else {
            alert("AI 生成失敗，請檢查 API Key 或網路連線。");
        }
        return null;
    }
}

// Generate Article
async function generateArticle(source = 'topic') {
    elements.articleSection.style.display = 'block';
    elements.articleContent.innerHTML = "<div style='text-align:center; padding: 2rem;'>AI 正在思考與撰寫文章...</div>";
    elements.articleTitle.innerText = "生成中...";
    state.currentVocab = []; // Clear for new article

    let prompt = "";
    if (source === 'topic') {
        const topic = elements.topicSelect.value;
        const diff = elements.diffSelect.value;
        const custom = elements.customPrompt.value;
        prompt = `Generate an English article for learning. Topic: ${topic}. Difficulty: ${diff}. Specific info: ${custom}.
        Return JSON format: { "title": "...", "content": "..." }`;
    } else {
        const words = state.vocabulary.map(v => v.word).join(', ');
        prompt = `Generate an English article using these vocabulary words: ${words}. Difficulty: ${elements.diffSelect.value}.
        Return JSON format: { "title": "...", "content": "..." }`;
    }

    const result = await callGemini(prompt);
    if (result) {
        state.currentArticle = result;
        renderArticle(result.title, result.content);
        generateQuiz(result.content);
        switchVocabTab('current'); // Switch to current article vocab automatically
    }
}

function renderArticle(title, content) {
    elements.articleTitle.innerText = title;
    const words = content.split(/\s+/);
    elements.articleContent.innerHTML = words.map(word => {
        const cleanWord = word.replace(/[.,\/#!$%\^&\*;:{}=\-_`~()]/g, "");
        return `<span onclick="handleWordClick(event, '${cleanWord}')">${word}</span>`;
    }).join(' ');
}

// Generate Quiz
async function generateQuiz(content) {
    // 提升測驗生成的上下文上限，確保長文也能生成完整測驗
    const contextLimit = 15000;
    const processingText = content.length > contextLimit ? content.substring(0, contextLimit) + "..." : content;

    const prompt = `Task: Generate 3 English comprehension MCQs based on this text: "${processingText}".
    Requirement: Questions/Options in English, Explanation in Traditional Chinese.
    Format: ONLY return a JSON Array [{question, options, answer(int), explanation}]. No prose, no markdown labels.`;
    const quiz = await callGemini(prompt);
    if (quiz) state.currentQuiz = quiz;
}

// Word Logic
async function handleWordClick(event, word) {
    if (!word) return;
    const tooltip = elements.wordTooltip;
    const tooltipWord = getEl('tooltip-word');
    const tooltipDef = getEl('tooltip-def');
    const saveBtn = getEl('save-word-btn');

    if (!tooltip || !tooltipWord || !tooltipDef) return;

    // 重設狀態，防止殘留
    tooltipWord.innerText = word;
    tooltipDef.innerText = "翻譯中...";
    if (saveBtn) {
        saveBtn.onclick = null;
        saveBtn.style.display = 'none';
    }

    const rect = event.target.getBoundingClientRect();
    tooltip.style.top = `${rect.bottom + window.scrollY + 5}px`;
    tooltip.style.left = `${rect.left + window.scrollX}px`;
    tooltip.style.display = 'block';

    const prompt = `Translate this English word to Traditional Chinese and provide a short English definition: "${word.replace(/"/g, '\\"')}".
    Return JSON: { "translation": "...", "definition": "..." }`;
    const result = await callGemini(prompt);

    if (result) {
        tooltipDef.innerText = `${result.translation} - ${result.definition}`;
        if (saveBtn) {
            saveBtn.style.display = 'block';
            saveBtn.onclick = () => saveWord(word, result.translation, result.definition);
        }
    }
}

function saveWord(word, translation, definition) {
    const wordObj = { word, translation, definition };

    // Add to current article vocab if not present
    if (!state.currentVocab.find(v => v.word.toLowerCase() === word.toLowerCase())) {
        state.currentVocab.unshift(wordObj);
    }

    // Add to all vocab if not present
    if (!state.vocabulary.find(v => v.word.toLowerCase() === word.toLowerCase())) {
        state.vocabulary.unshift(wordObj);
        localStorage.setItem('vibe_vocab', JSON.stringify(state.vocabulary));
    }

    renderVocabulary();
    elements.wordTooltip.style.display = 'none';
}

function switchVocabTab(tab) {
    state.activeTab = tab;
    document.getElementById('tab-current').className = `vocab-tab ${tab === 'current' ? 'active' : ''}`;
    document.getElementById('tab-all').className = `vocab-tab ${tab === 'all' ? 'active' : ''}`;
    renderVocabulary();
}

function renderVocabulary() {
    const isAll = state.activeTab === 'all';
    const list = state.activeTab === 'current' ? state.currentVocab : state.vocabulary;
    if (list.length === 0) {
        elements.vocabItems.innerHTML = `<div style="text-align:center; color:var(--text-muted); padding:1rem;">尚無單字</div>`;
        return;
    }

    elements.vocabItems.innerHTML = list.map(v => `
        <div class="vocab-item animate-in">
            <div style="flex: 1;">
                <div style="display:flex; justify-content:space-between; align-items:center;">
                    <span class="vocab-word">${v.word}</span>
                    <button onclick="speak('${v.word.replace(/'/g, "\\'")}')" style="padding: 2px 8px; font-size: 0.7rem; background:none; color:var(--text-muted); border:none; cursor:pointer;">🔊</button>
                </div>
                <span class="vocab-def">${v.translation} - ${v.definition}</span>
            </div>
            ${isAll ? `<button class="delete-btn" data-word="${v.word.replace(/"/g, '&quot;')}" title="刪除">×</button>` : ''}
        </div>
    `).join('');
}

window.deleteWord = function (word) {
    if (confirm(`確定要刪除單字 "${word}" 嗎？`)) {
        state.vocabulary = state.vocabulary.filter(v => v.word.toLowerCase() !== word.toLowerCase());
        localStorage.setItem('vibe_vocab', JSON.stringify(state.vocabulary));
        renderVocabulary();
    }
};

// Speech Evolution
function loadVoices() {
    const voices = window.speechSynthesis.getVoices();
    if (!elements.voiceSelect) return;
    elements.voiceSelect.innerHTML = voices
        .filter(v => v.lang.startsWith('en'))
        .map(v => `<option value="${v.name}">${v.name}</option>`)
        .join('');
}

window.speechSynthesis.onvoiceschanged = loadVoices;

function speak(text) {
    if (window.speechSynthesis.speaking) {
        if (window.speechSynthesis.paused) {
            window.speechSynthesis.resume();
            elements.pauseBtn.innerText = "⏸ 暫停";
            return;
        } else {
            window.speechSynthesis.pause();
            elements.pauseBtn.innerText = "▶️ 繼續";
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
        elements.pauseBtn.style.display = 'block';
        elements.pauseBtn.innerText = "⏸ 暫停";
        document.getElementById('tts-article-btn').innerText = "⏹ 停止朗讀";
    };

    utterance.onend = () => {
        elements.pauseBtn.style.display = 'none';
        document.getElementById('tts-article-btn').innerText = "🔊 全文朗讀";
    };

    window.speechSynthesis.speak(utterance);
}

// Calendar & Stats
function renderCalendar() {
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth();
    elements.currentMonth.innerText = `${year}年 ${month + 1}月`;

    const firstDay = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();

    let html = "";
    for (let i = 0; i < firstDay; i++) {
        html += `<div class="calendar-day"></div>`;
    }

    let monthTotal = 0;
    for (let day = 1; day <= daysInMonth; day++) {
        const dateKey = `${year}-${month + 1}-${day}`;
        const count = state.readingHistory[dateKey] || 0;
        monthTotal += count;
        const isActive = (day === now.getDate()) ? 'active' : '';
        html += `
            <div class="calendar-day ${isActive}">
                ${day}
                ${count > 0 ? `<span class="read-count">${count}</span>` : ''}
            </div>
        `;
    }
    elements.calendarGrid.innerHTML = html;
    elements.monthTotal.innerText = `本月閱讀: ${monthTotal}`;
}

function recordReading() {
    const now = new Date();
    const dateKey = `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}`;
    state.readingHistory[dateKey] = (state.readingHistory[dateKey] || 0) + 1;
    localStorage.setItem('vibe_reading', JSON.stringify(state.readingHistory));
    updateStreak();
    renderCalendar();
}

function updateStreak() {
    let streak = 0;
    let checkDate = new Date();
    while (true) {
        const key = `${checkDate.getFullYear()}-${checkDate.getMonth() + 1}-${checkDate.getDate()}`;
        if (state.readingHistory[key]) {
            streak++;
            checkDate.setDate(checkDate.getDate() - 1);
        } else {
            break;
        }
    }
    state.streak = streak;
    elements.streakDisplay.innerText = `🔥 連續閱讀: ${streak} 天`;
}

// Quiz Visuals
function renderQuiz() {
    elements.quizContainer.innerHTML = state.currentQuiz.map((q, i) => `
        <div class="quiz-item" style="margin-bottom: 1.2rem; border-bottom: 1px solid var(--card-border); padding-bottom: 0.6rem;">
            <p style="margin-bottom: 0.4rem; font-size: 1.05rem; line-height: 1.3;"><strong>Q${i + 1}: ${q.question}</strong></p>
            <div class="options" style="display: flex; flex-direction: column; gap: 0.1rem;">
                ${q.options.map((opt, oi) => `
                    <label class="quiz-option" style="display:flex; align-items: flex-start; gap: 0.5rem; padding: 0.2rem 0; cursor:pointer; font-size: 0.95rem; line-height: 1.4; text-align: left; width: 100%;" id="q${i}-opt${oi}">
                        <input type="radio" name="q${i}" value="${oi}" style="flex-shrink: 0; margin: 0.3rem 0 0 0; padding: 0; width: auto; height: auto; border: none; background: none;"> 
                        <span style="flex: 1;">${opt}</span>
                    </label>
                `).join('')}
            </div>
            <div class="quiz-explanation" id="expl-${i}">
                <p><strong>正確答案:</strong> ${q.options[q.answer]}</p>
                <p style="margin-top:0.4rem;">${q.explanation}</p>
            </div>
        </div>
    `).join('');
}

// Event Listeners
function setupEventListeners() {
    elements.generateBtn.addEventListener('click', () => generateArticle('topic'));
    elements.vocabGenerateBtn.addEventListener('click', () => generateArticle('vocab'));

    elements.startQuizBtn.addEventListener('click', () => {
        if (!state.currentQuiz) return alert("測驗尚未生成，請稍候...");
        renderQuiz();
        elements.quizModal.style.display = 'flex';
        document.getElementById('submit-quiz').style.display = 'block';
    });

    document.getElementById('close-quiz').onclick = () => elements.quizModal.style.display = 'none';

    document.getElementById('submit-quiz').onclick = () => {
        const results = state.currentQuiz.map((q, i) => {
            const selected = document.querySelector(`input[name="q${i}"]:checked`);
            return {
                correct: selected && parseInt(selected.value) === q.answer,
                selectedIndex: selected ? parseInt(selected.value) : -1
            };
        });

        // Show explanations and highlight answers
        state.currentQuiz.forEach((q, i) => {
            const expl = document.getElementById(`expl-${i}`);
            expl.classList.add('visible');

            const selectedLabel = document.getElementById(`q${i}-opt${results[i].selectedIndex}`);
            const correctLabel = document.getElementById(`q${i}-opt${q.answer}`);

            if (results[i].correct) {
                if (correctLabel) correctLabel.classList.add('correct-answer');
            } else {
                if (selectedLabel) selectedLabel.classList.add('wrong-answer');
                if (correctLabel) correctLabel.classList.add('correct-answer');
            }
        });

        recordReading();
        document.getElementById('submit-quiz').style.display = 'none'; // Prevent double submit
    };

    document.getElementById('tts-article-btn').onclick = () => {
        if (window.speechSynthesis.speaking && !window.speechSynthesis.paused) {
            window.speechSynthesis.cancel();
            document.getElementById('tts-article-btn').innerText = "🔊 全文朗讀";
            elements.pauseBtn.style.display = 'none';
        } else {
            speak(state.currentArticle.content);
        }
    };

    elements.pauseBtn.onclick = () => {
        if (window.speechSynthesis.paused) {
            window.speechSynthesis.resume();
            elements.pauseBtn.innerText = "⏸ 暫停";
        } else {
            window.speechSynthesis.pause();
            elements.pauseBtn.innerText = "▶️ 繼續";
        }
    };

    // 初始化語音
    setTimeout(loadVoices, 500);

    window.addEventListener('click', (e) => {
        if (!elements.wordTooltip.contains(e.target) && !elements.articleContent.contains(e.target)) {
            elements.wordTooltip.style.display = 'none';
        }
    });

    // Event delegation for dynamically added delete buttons
    elements.vocabItems.addEventListener('click', (e) => {
        if (e.target.classList.contains('delete-btn')) {
            const word = e.target.dataset.word;
            console.log('Delete requested for:', word); // Debug
            deleteWord(word);
        }
    });

    // Handle initial global function for HTML onclick (keep for legacy or external calls if any)
    window.switchVocabTab = switchVocabTab;

    // 監聽儲存事件，達成與擴充套件的即時同步 UI 更新
    window.addEventListener('storage', () => {
        const vocab = localStorage.getItem('vibe_vocab');
        const reading = localStorage.getItem('vibe_reading');
        const key = localStorage.getItem('vibe_api_key');

        if (vocab) state.vocabulary = JSON.parse(vocab);
        if (reading) state.readingHistory = JSON.parse(reading);
        if (key) API_KEY = key;

        renderVocabulary();
        renderCalendar();
        updateStreak();
    });
}

// Settings Logic
function setupSettings() {
    // Fill input if key exists
    if (API_KEY) {
        elements.apiKeyInput.value = API_KEY;
    }

    elements.settingsBtn.addEventListener('click', openSettings);

    elements.closeSettingsBtn.addEventListener('click', () => {
        if (!API_KEY) return alert("請先設定 API Key 才能使用。");
        elements.settingsModal.style.display = 'none';
    });

    elements.saveKeyBtn.addEventListener('click', () => {
        const key = elements.apiKeyInput.value.trim();
        if (!key) return alert("API Key 不能為空");

        API_KEY = key;
        localStorage.setItem('vibe_api_key', key);
        alert("API Key 已儲存！");
        elements.settingsModal.style.display = 'none';
    });

    elements.showKeyToggle.addEventListener('change', (e) => {
        elements.apiKeyInput.type = e.target.checked ? 'text' : 'password';
    });
}

function openSettings() {
    elements.settingsModal.style.display = 'flex';
}

// Start
init();
