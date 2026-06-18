/* Plan onboarding: collects travel party, kids, travel mode.
 * Shown when user first visits Plan. Saves to holidayHacker_travelPreferences.
 * On completion: hides overlay, dispatches planPrefsDone for plan.js to re-score. */
(function () {
  'use strict';

  var STORAGE_KEY = 'holidayHacker_user';
  var TRAVEL_PREFS_KEY = 'holidayHacker_travelPreferences';
  var PLAN_PREFS_DONE_KEY = 'holidayHacker_planPrefsDone';

  var overlay = document.getElementById('planChatOverlay');
  var planContent = document.getElementById('planContent');
  var chatArea = document.getElementById('planChatArea');
  var chatFooter = document.getElementById('planChatFooter');
  var glassNav = document.querySelector('.glass-nav');

  if (!overlay || !chatArea || !chatFooter) return;

  var pageEl = document.querySelector('.plan-page .page');

  function setOnboardPageLayout(active) {
    if (pageEl) pageEl.classList.toggle('page--onboard-chat', !!active);
  }

  var raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    window.location.href = '../index.html';
    return;
  }
  var user = JSON.parse(raw);
  if (!user.name && !user.workLocation) {
    window.location.href = '../index.html';
    return;
  }

  var hasPrefs = (function () {
    try {
      var p = JSON.parse(localStorage.getItem(TRAVEL_PREFS_KEY) || '{}');
      return (p.travelModes && p.travelModes.length) || p.travelMode || localStorage.getItem(PLAN_PREFS_DONE_KEY);
    } catch (e) { return false; }
  })();
  if (localStorage.getItem(PLAN_PREFS_DONE_KEY) || hasPrefs) {
    overlay.style.display = 'none';
    if (planContent) planContent.style.display = '';
    if (glassNav) glassNav.style.display = '';
    return;
  }

  if (planContent) planContent.style.display = 'none';
  if (glassNav) glassNav.style.display = 'none';
  setOnboardPageLayout(true);

  var answers = {};
  var currentStep = 0;

  var STEPS = [
    {
      type: 'bot',
      message: function () {
        var name = user.name || 'there';
        return 'Hey ' + name + '! Let\'s personalize your trip recommendations. I\'ll ask a couple of quick questions so we can suggest the best destinations for you.';
      }
    },
    {
      type: 'input',
      key: 'travelParty',
      botMessage: 'Who is joining you on this trip?',
      inputType: 'chips',
      options: [
        { label: 'Solo', value: 'solo', icon: 'person' },
        { label: 'Couple', value: 'couple', icon: 'favorite' },
        { label: 'Family', value: 'family', icon: 'family_restroom' },
        { label: 'Group', value: 'group', icon: 'groups' }
      ]
    },
    {
      type: 'input',
      key: 'hasKidsUnder10',
      botMessage: 'Are there children under 10 traveling? We\'ll prioritize easier terrains and kid-friendly activities.',
      inputType: 'chips',
      options: [
        { label: 'Yes', value: true, icon: 'child_care' },
        { label: 'No', value: false, icon: 'check_circle' }
      ],
      skipIf: function () { return answers.travelParty !== 'family'; }
    },
    {
      type: 'input',
      key: 'travelModes',
      botMessage: 'How would you like to get there? (Select one or more — tap in priority order)',
      inputType: 'chipsMulti',
      options: [
        { label: 'Car', value: 'car', icon: 'directions_car' },
        { label: 'Bus', value: 'bus', icon: 'directions_bus' },
        { label: 'Train', value: 'train', icon: 'train' },
        { label: 'Flight', value: 'flight', icon: 'flight' }
      ]
    },
    {
      type: 'input',
      key: 'destinationSegments',
      botMessage: 'What type of places do you enjoy? (Select one or more)',
      inputType: 'chipsMulti',
      options: [
        { label: 'Beach / Coastal', value: 'beach', icon: 'beach_access' },
        { label: 'Mountain / Hills', value: 'mountain', icon: 'terrain' },
        { label: 'Heritage / Culture', value: 'heritage', icon: 'account_balance' },
        { label: 'Wildlife / Nature', value: 'wildlife', icon: 'pets' },
        { label: 'City / Urban', value: 'city', icon: 'location_city' },
        { label: 'Spiritual / Pilgrimage', value: 'spiritual', icon: 'volunteer_activism' }
      ]
    },
    {
      type: 'bot',
      message: 'All set! Loading destinations tailored for you \u{1F389}',
      final: true
    }
  ];

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

  function showChipsMulti(options) {
    var key = STEPS[currentStep].key;
    if (!answers[key]) answers[key] = [];
    var selected = answers[key];
    var html = '<div class="chat-chips chat-chips--multi">';
    options.forEach(function (opt) {
      var sel = selected.indexOf(opt.value) !== -1;
      var cls = sel ? ' chat-chip--selected' : '';
      html += '<button type="button" class="chat-chip' + cls + '" data-value="' + opt.value + '" data-multi="1">';
      if (opt.icon) html += '<span class="material-symbols-outlined">' + opt.icon + '</span> ';
      html += opt.label + '</button>';
    });
    html += '</div>';
    if (key === 'travelModes') {
      html += '<p class="chat-priority-hint">Tap in priority order — your first pick is your primary mode.</p>';
    }
    html += '<button type="button" class="chat-chip-continue" id="chatChipsContinue">Continue</button>' +
      '<div class="chat-privacy"><span class="material-symbols-outlined">lock</span> Your data stays on this device</div>';
    chatFooter.innerHTML = html;
    scrollToBottom();

    function renderSelectedState() {
      var arr = Array.isArray(answers[key]) ? answers[key] : [];
      var primaryMode = key === 'travelModes' && arr.length ? arr[0] : null;
      chatFooter.querySelectorAll('.chat-chip[data-multi="1"]').forEach(function (btn) {
        var val = btn.getAttribute('data-value');
        var sel = arr.indexOf(val) !== -1;
        btn.classList.toggle('chat-chip--selected', sel);
        var oldPill = btn.querySelector('.holiday-today-pill');
        if (oldPill) oldPill.remove();
        if (sel && val === primaryMode) {
          var pill = document.createElement('span');
          pill.className = 'holiday-today-pill';
          pill.textContent = 'Primary';
          btn.appendChild(pill);
        }
      });
    }

    function toggleChipValue(v) {
      var arr = Array.isArray(answers[key]) ? answers[key].slice() : [];
      var idx = arr.indexOf(v);
      if (idx !== -1) arr.splice(idx, 1);
      else arr.push(v);
      answers[key] = arr;
      renderSelectedState();
    }

    chatFooter.querySelectorAll('.chat-chip[data-multi="1"]').forEach(function (btn) {
      btn.onclick = function (e) {
        e.preventDefault();
        e.stopPropagation();
        toggleChipValue(btn.getAttribute('data-value'));
      };
    });

    renderSelectedState();
    document.getElementById('chatChipsContinue').addEventListener('click', function () {
      var arr = answers[key];
      if (key === 'travelModes' && !arr.length) arr.push('car');
      var lbl = arr.length
        ? arr.map(function (s) {
            return (options.find(function (o) { return o.value === s; }) || {}).label || s;
          }).join(', ')
        : (key === 'travelModes' ? 'Car' : 'None selected');
      addUserMessage(lbl);
      clearFooter();
      currentStep++;
      setTimeout(processStep, 350);
    });
  }

  function showChips(options) {
    var html = '<div class="chat-chips">';
    options.forEach(function (opt) {
      var icon = opt.icon ? '<span class="material-symbols-outlined">' + opt.icon + '</span> ' : '';
      html += '<button type="button" class="chat-chip" data-value="' + (opt.value === true ? 'true' : (opt.value === false ? 'false' : opt.value)) + '">' + icon + opt.label + '</button>';
    });
    html += '</div><div class="chat-privacy"><span class="material-symbols-outlined">lock</span> Your data stays on this device</div>';
    chatFooter.innerHTML = html;
    scrollToBottom();

    chatFooter.querySelectorAll('.chat-chip').forEach(function (chip) {
      chip.addEventListener('click', function () {
        var v = chip.getAttribute('data-value');
        if (v === 'true') v = true;
        else if (v === 'false') v = false;
        handleAnswer(v);
      });
    });
  }

  function clearFooter() {
    chatFooter.innerHTML = '<div class="chat-privacy"><span class="material-symbols-outlined">lock</span> Your data stays on this device</div>';
  }

  function labelForValue(key, value) {
    for (var i = 0; i < STEPS.length; i++) {
      if (STEPS[i].key === key && STEPS[i].options) {
        for (var j = 0; j < STEPS[i].options.length; j++) {
          var o = STEPS[i].options[j];
          if (o.value === value) return o.label;
        }
      }
    }
    return String(value);
  }

  function handleAnswer(value) {
    var step = STEPS[currentStep];
    answers[step.key] = value;

    var display = labelForValue(step.key, value);
    addUserMessage(display);
    clearFooter();

    currentStep++;
    setTimeout(processStep, 350);
  }

  function processStep() {
    while (currentStep < STEPS.length) {
      var step = STEPS[currentStep];
      var skipIf = step.skipIf && step.skipIf();
      if (skipIf) {
        answers[step.key] = false;
        currentStep++;
        continue;
      }
      break;
    }

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
        if (step.inputType === 'chips') showChips(step.options);
        else if (step.inputType === 'chipsMulti') showChipsMulti(step.options);
      });
    }
  }

  function deriveAdultsChildren(party, hasKids) {
    if (party === 'solo') return { adults: 1, children: 0 };
    if (party === 'couple') return { adults: 2, children: 0 };
    if (party === 'family') return { adults: 2, children: hasKids ? 1 : 0 };
    if (party === 'group') return { adults: 4, children: 0 };
    return { adults: 2, children: 0 };
  }

  function saveAndTransition() {
    var modes = answers.travelModes;
    if (!modes || !modes.length) modes = ['car'];
    var party = answers.travelParty || 'solo';
    var hasKids = answers.hasKidsUnder10 === true || answers.hasKidsUnder10 === 'true';
    var fam = deriveAdultsChildren(party, hasKids);
    var prefs = {
      travelModes: modes,
      travelParty: party,
      hasKidsUnder10: hasKids,
      adults: fam.adults,
      children: fam.children,
      destinationSegments: Array.isArray(answers.destinationSegments) ? answers.destinationSegments : []
    };
    localStorage.setItem(TRAVEL_PREFS_KEY, JSON.stringify(prefs));
    localStorage.setItem(PLAN_PREFS_DONE_KEY, '1');

    setTimeout(function () {
      overlay.style.opacity = '0';
      overlay.style.transition = 'opacity 0.4s ease';
      setTimeout(function () {
        overlay.style.display = 'none';
        setOnboardPageLayout(false);
        if (planContent) planContent.style.display = '';
        if (glassNav) glassNav.style.display = '';
        window.dispatchEvent(new CustomEvent('planPrefsDone', { detail: prefs }));
      }, 400);
    }, 1500);
  }

  processStep();
})();
