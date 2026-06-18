/* Calendar onboarding chat: collects weeklyOff and pendingLeaves.
 * Shown only when user has completed main onboarding (index.html) but not
 * calendar setup. Flow: bot greeting → chips (weekly off) → slider (leaves)
 * → save to user, set CAL_DONE_KEY, hide overlay. */
(function () {
  'use strict';

  var STORAGE_KEY  = 'holidayHacker_user';
  var CAL_DONE_KEY = 'holidayHacker_calSetup';

  var overlay     = document.getElementById('calChatOverlay');
  var calSplit    = document.getElementById('calSplit');
  var chatArea    = document.getElementById('calChatArea');
  var chatFooter  = document.getElementById('calChatFooter');
  var glassNav    = document.querySelector('.glass-nav');

  if (!overlay || !chatArea || !chatFooter) return;

  var pageEl = document.querySelector('.calendar-page .page');

  function setOnboardPageLayout(active) {
    if (pageEl) pageEl.classList.toggle('page--onboard-chat', !!active);
  }

  /* ─── Redirect if no user data ───────────────────────── */
  var raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    window.location.href = '../index.html';
    return;
  }
  var userData = JSON.parse(raw);
  if (!userData.name && !userData.workLocation) {
    window.location.href = '../index.html';
    return;
  }

  /* ─── Skip if already completed ─────────────────────── */
  if (localStorage.getItem(CAL_DONE_KEY)) {
    overlay.style.display = 'none';
    calSplit.style.display = '';
    return;
  }

  if (glassNav) glassNav.style.display = 'none';
  setOnboardPageLayout(true);

  var user = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
  var answers = {};
  var currentStep = 0;

  var STEPS = [
    {
      type: 'bot',
      message: function () {
        var name = user.name || 'there';
        return 'Hey ' + name + '! Before we fire up your calendar, I need a couple of quick details about your work schedule. This helps me highlight your off-days and plan smarter.';
      }
    },
    {
      type: 'input',
      key: 'weeklyOff',
      botMessage: 'What does your weekly off look like?',
      inputType: 'chips',
      options: [
        { label: 'Sat–Sun Off',       value: 'sat-sun',      icon: 'weekend' },
        { label: 'Sunday Only Off',    value: 'sun-only',     icon: 'calendar_today' },
        { label: '2nd & 4th Sat Off',  value: '2nd-4th-sat',  icon: 'date_range' },
        { label: 'Custom / Shift Off', value: 'custom',       icon: 'tune' }
      ]
    },
    {
      type: 'input',
      key: 'pendingLeaves',
      botMessage: 'How many pending leaves do you have left this year?',
      inputType: 'slider'
    },
    {
      type: 'bot',
      message: 'All set! Your calendar is now personalized. Let\u2019s see what your month looks like \u{1F389}',
      final: true
    }
  ];

  /* ─── Helpers ──────────────────────────────────────── */

  function getTime() {
    var d = new Date();
    var h = d.getHours();
    var m = d.getMinutes();
    var ampm = h >= 12 ? 'PM' : 'AM';
    h = h % 12 || 12;
    return h + ':' + (m < 10 ? '0' + m : m) + ' ' + ampm;
  }

  var scrollToBottom = typeof HH_bindChatScroll === 'function'
    ? HH_bindChatScroll(chatArea, chatFooter)
    : function () {
        requestAnimationFrame(function () {
          chatArea.scrollTop = chatArea.scrollHeight;
        });
      };

  function privacyHTML() {
    return '<div class="chat-privacy"><span class="material-symbols-outlined">lock</span> Your data stays on this device</div>';
  }

  /* ─── Message renderers ────────────────────────────── */

  function addBotMessage(text, callback) {
    var typingRow = document.createElement('div');
    typingRow.className = 'chat-row chat-row--animate';
    typingRow.innerHTML =
      '<div class="avatar"><span class="material-symbols-outlined">smart_toy</span></div>' +
      '<div class="bubble-wrap"><div class="bubble">' +
      '<div class="typing-indicator"><span class="typing-dot"></span><span class="typing-dot"></span><span class="typing-dot"></span></div>' +
      '</div></div>';
    chatArea.appendChild(typingRow);
    scrollToBottom();

    var delay = Math.max(800, Math.min(text.length * 7, 1600));

    setTimeout(function () {
      if (typingRow.parentNode) typingRow.parentNode.removeChild(typingRow);
      var row = document.createElement('div');
      row.className = 'chat-row chat-row--animate';
      row.innerHTML =
        '<div class="avatar"><span class="material-symbols-outlined">smart_toy</span></div>' +
        '<div class="bubble-wrap"><div class="bubble"><p>' + text + '</p></div>' +
        '<span class="bubble-time">' + getTime() + '</span></div>';
      chatArea.appendChild(row);
      scrollToBottom();
      if (callback) setTimeout(callback, 350);
    }, delay);
  }

  function addUserMessage(text) {
    var row = document.createElement('div');
    row.className = 'chat-row chat-row--user chat-row--animate';
    row.innerHTML =
      '<div class="bubble-wrap bubble-wrap--user"><div class="bubble bubble--user"><p>' + text + '</p></div>' +
      '<span class="bubble-time bubble-time--user">' + getTime() + '</span></div>';
    chatArea.appendChild(row);
    scrollToBottom();
  }

  /* ─── Input renderers ──────────────────────────────── */

  function showChips(options) {
    var html = '<div class="chat-chips">';
    options.forEach(function (opt) {
      var icon = opt.icon
        ? '<span class="material-symbols-outlined">' + opt.icon + '</span> '
        : '';
      html += '<button type="button" class="chat-chip" data-value="' + opt.value + '">' + icon + opt.label + '</button>';
    });
    html += '</div>' + privacyHTML();
    chatFooter.innerHTML = html;
    scrollToBottom();

    chatFooter.querySelectorAll('.chat-chip').forEach(function (chip) {
      chip.addEventListener('click', function () {
        handleAnswer(chip.getAttribute('data-value'));
      });
    });
  }

  function showSlider() {
    var html =
      '<div class="chat-slider-wrap">' +
        '<div class="chat-slider-value" id="sliderDisplay">12</div>' +
        '<input type="range" class="chat-slider" id="chatSlider" min="0" max="30" value="12" step="1"/>' +
        '<div class="chat-slider-labels"><span>0</span><span>30</span></div>' +
        '<button type="button" class="chat-slider-confirm" id="sliderConfirm">' +
          '<span class="material-symbols-outlined">check</span> Confirm' +
        '</button>' +
      '</div>' + privacyHTML();
    chatFooter.innerHTML = html;
    scrollToBottom();

    var slider  = document.getElementById('chatSlider');
    var display = document.getElementById('sliderDisplay');
    var confirm = document.getElementById('sliderConfirm');

    slider.addEventListener('input', function () {
      display.textContent = slider.value;
    });

    confirm.addEventListener('click', function () {
      handleAnswer(slider.value);
    });
  }

  /* ─── Flow control ─────────────────────────────────── */

  function clearFooter() {
    chatFooter.innerHTML = privacyHTML();
  }

  function labelForValue(key, value) {
    for (var i = 0; i < STEPS.length; i++) {
      if (STEPS[i].key === key && STEPS[i].options) {
        for (var j = 0; j < STEPS[i].options.length; j++) {
          if (STEPS[i].options[j].value === value) return STEPS[i].options[j].label;
        }
      }
    }
    return value;
  }

  function handleAnswer(value) {
    var step = STEPS[currentStep];
    answers[step.key] = value;

    var display = (step.inputType === 'slider')
      ? value + ' days'
      : labelForValue(step.key, value);
    addUserMessage(display);
    clearFooter();

    currentStep++;
    setTimeout(processStep, 350);
  }

  function processStep() {
    if (currentStep >= STEPS.length) return;
    var step = STEPS[currentStep];
    var msg = typeof step.message === 'function' ? step.message() : step.message;
    var botMsg = typeof step.botMessage === 'function' ? step.botMessage() : step.botMessage;

    if (step.type === 'bot') {
      addBotMessage(msg, function () {
        if (step.final) {
          saveAndTransition();
        } else {
          currentStep++;
          processStep();
        }
      });
    } else if (step.type === 'input') {
      addBotMessage(botMsg, function () {
        if (step.inputType === 'chips')  showChips(step.options);
        else if (step.inputType === 'slider') showSlider();
      });
    }
  }

  function saveAndTransition() {
    user.weeklyOff      = answers.weeklyOff;
    user.pendingLeaves  = parseInt(answers.pendingLeaves, 10);
    user.annualLeaves   = user.pendingLeaves;
    user.lastUpdated    = new Date().toISOString();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(user));
    localStorage.setItem(CAL_DONE_KEY, '1');

    setTimeout(function () {
      overlay.style.opacity = '0';
      setTimeout(function () {
        overlay.style.display = 'none';
        setOnboardPageLayout(false);
        calSplit.style.display = '';
        if (glassNav) glassNav.style.display = '';
        if (typeof window.initCalendar === 'function') window.initCalendar();
      }, 400);
    }, 2000);
  }

  /* ─── Start ────────────────────────────────────────── */
  processStep();
})();
