(function () {
  'use strict';

  var userData = localStorage.getItem('holidayHacker_user');
  if (userData) {
    window.location.href = 'calendar/index.html';
    return;
  }

  var chatArea = document.getElementById('chatArea');
  var chatFooter = document.getElementById('chatFooter');
  var page = document.getElementById('page');
  var answers = {};
  var cityData = [];
  var currentStep = 0;
  var CITY_ALIAS_MAP = {};

  var STEPS = [
    {
      type: 'bot',
      message: 'Welcome to Holiday Hacker! \u{1F680} I\'m here to help you turn your standard public holidays into epic, week-long vacations without burning through your leave balance. I\'ll analyze your local holidays, suggest the best travel windows, and even remind you exactly when to book your tickets.'
    },
    {
      type: 'bot',
      message: 'Before we dive into your personalized roadmap, I just need to ask a few quick questions to set up your engine. It\'ll take a few seconds, and we\'ll jump straight into the app. Your data stays private and is stored only on this device.',
      accent: true
    },
    {
      type: 'input',
      key: 'name',
      botMessage: 'First, what should I call you?',
      inputType: 'text',
      placeholder: 'Type your name\u2026'
    },
    {
      type: 'input',
      key: 'ageGroup',
      botMessage: function () {
        return 'Nice to meet you, ' + answers.name + '! What is your age group?';
      },
      inputType: 'chips',
      options: [
        { label: 'Below 30', value: 'Below 30' },
        { label: '31\u201345', value: '31-45' },
        { label: '45 Above', value: '45 Above' }
      ]
    },
    {
      type: 'input',
      key: 'gender',
      botMessage: 'And your gender?',
      inputType: 'chips',
      options: [
        { label: 'Male', value: 'Male', icon: 'male' },
        { label: 'Female', value: 'Female', icon: 'female' },
        { label: 'Other', value: 'Other', icon: 'transgender' }
      ]
    },
    {
      type: 'input',
      key: 'workLocation',
      botMessage: 'Where do you currently work? (City or State)',
      inputType: 'dropdown',
      placeholder: 'Search city or state\u2026'
    },
    {
      type: 'input',
      key: 'homeLocation',
      botMessage: 'Where is \u2018Home\u2019 for you? (This helps me track your hometown festivals)',
      inputType: 'dropdown',
      placeholder: 'Search city or state\u2026',
      showSameOption: true
    },
    {
      type: 'bot',
      message: function () {
        var work = answers.workLocation.split(',')[0];
        var home = answers.homeLocation.split(',')[0];
        if (normalizeText(work) === normalizeText(home)) {
          return 'Got it! I\u2019ve synced the holidays for ' + work + '. Now a couple of quick work-schedule questions so I can highlight your off-days and plan smarter \u{1F4AA}';
        }
        return 'Got it! I\u2019ve synced the holidays for ' + work + ' and ' + home + '. Now a couple of quick work-schedule questions so I can highlight your off-days and plan smarter \u{1F4AA}';
      }
    },
    {
      type: 'input',
      key: 'weeklyOff',
      botMessage: 'What does your weekly off look like?',
      inputType: 'chips',
      options: [
        { label: 'Sat\u2013Sun Off',       value: 'sat-sun',      icon: 'weekend' },
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
      message: function () {
        return 'All set, ' + answers.name + '! Your personalized calendar is ready \u2014 let\u2019s see your upcoming holidays, golden bridges, and mega weekends! \u{1F680}';
      },
      final: true
    }
  ];

  /* ---- Helpers ---- */

  function capitalizeName(str) {
    return str.replace(/\S+/g, function (word) {
      return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    });
  }

  function normalizeText(str) {
    return (str || '').toLowerCase().replace(/[\s\-_.,']/g, '');
  }

  /* Normalised district/city slug: alias values in data.json are hyphenated
   * (e.g. mumbai-city); keys are alternate names (bombay, mumbai). */
  function aliasToCanonical(str) {
    var key = normalizeText(str);
    var v = CITY_ALIAS_MAP[key];
    if (v) return normalizeText(v);
    return key;
  }

  function aliasesForSlugNorm(slugNorm) {
    var target = slugNorm || '';
    if (!target) return [];
    var out = [];
    Object.keys(CITY_ALIAS_MAP).forEach(function (k) {
      if (normalizeText(CITY_ALIAS_MAP[k]) === target) out.push(normalizeText(k));
    });
    return out;
  }

  function cityDataMatches(item, query) {
    var qN = normalizeText(query);
    if (!qN) return true;
    var qSlug = aliasToCanonical(query);
    var slugN = item.slugNorm || '';
    var cityN = normalizeText(item.city || '');
    var stateN = normalizeText(item.state || '');
    var labelN = normalizeText(item.label || '');
    if (slugN && qSlug === slugN) return true;
    var tokens = [labelN, cityN, stateN, slugN];
    aliasesForSlugNorm(slugN).forEach(function (a) { tokens.push(a); });
    return tokens.some(function (t) {
      return t && t.indexOf(qN) !== -1;
    });
  }

  function rankLocItem(item, query) {
    var qN = normalizeText(query);
    if (!qN) return 0;
    var score = 0;
    var cityN = normalizeText(item.city || '');
    var slugN = item.slugNorm || '';
    var qSlug = aliasToCanonical(query);
    if (slugN && qSlug === slugN) score += 500;
    if (cityN.indexOf(qN) === 0) score += 200;
    else if (cityN.indexOf(qN) !== -1) score += 100;
    var aliasList = aliasesForSlugNorm(slugN);
    for (var i = 0; i < aliasList.length; i++) {
      var ak = aliasList[i];
      if (ak.indexOf(qN) === 0) score += 190;
      else if (ak.indexOf(qN) !== -1) score += 95;
    }
    if (normalizeText(item.label || '').indexOf(qN) === 0) score += 60;
    if (item.major) score += 45;
    score -= Math.min(35, (item.city || '').length);
    return score;
  }

  function resolveLocationInput(input) {
    var qN = normalizeText(input);
    var qSlug = aliasToCanonical(input);
    var exact = cityData.find(function (item) {
      if (item.slugNorm && item.slugNorm === qSlug) return true;
      var l = normalizeText(item.label || '');
      var c = normalizeText(item.city || '');
      var s = normalizeText(item.state || '');
      return l === qN || c === qN || s === qN;
    });
    return exact ? exact.label : '';
  }

  function getTime() {
    var d = new Date();
    var h = d.getHours();
    var m = d.getMinutes();
    var ampm = h >= 12 ? 'PM' : 'AM';
    h = h % 12 || 12;
    return h + ':' + (m < 10 ? '0' + m : m) + ' ' + ampm;
  }

  function scrollToBottom() {
    requestAnimationFrame(function () {
      chatArea.scrollTop = chatArea.scrollHeight;
    });
  }

  function privacyHTML() {
    return '<div class="chat-privacy"><span class="material-symbols-outlined">lock</span> Your data stays on this device</div>';
  }

  /* ---- Message Renderers ---- */

  function addBotMessage(text, accent, callback) {
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
      var cls = accent ? 'bubble bubble--accent' : 'bubble';
      row.innerHTML =
        '<div class="avatar"><span class="material-symbols-outlined">smart_toy</span></div>' +
        '<div class="bubble-wrap"><div class="' + cls + '"><p>' + text + '</p></div>' +
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

  /* ---- Input Renderers ---- */

  function showTextInput(placeholder) {
    chatFooter.innerHTML =
      '<div class="chat-input-row">' +
        '<input type="text" class="chat-text-input" id="chatTextInput" placeholder="' + placeholder + '" autocomplete="off"/>' +
        '<button type="button" class="btn-send" id="btnSend" disabled>' +
          '<span class="material-symbols-outlined">send</span>' +
        '</button>' +
      '</div>' + privacyHTML();

    var input = document.getElementById('chatTextInput');
    var btn = document.getElementById('btnSend');

    setTimeout(function () { input.focus(); }, 100);

    input.addEventListener('input', function () {
      btn.disabled = !input.value.trim();
    });

    function submit() {
      var val = input.value.trim();
      if (!val) return;
      handleAnswer(val);
    }

    btn.addEventListener('click', submit);
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') submit();
    });
  }

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

    var slider  = document.getElementById('chatSlider');
    var display = document.getElementById('sliderDisplay');
    var confirmBtn = document.getElementById('sliderConfirm');

    slider.addEventListener('input', function () {
      display.textContent = slider.value;
    });

    confirmBtn.addEventListener('click', function () {
      handleAnswer(slider.value);
    });
  }

  function showDropdown(placeholder, showSame) {
    var sameHTML = showSame
      ? '<label class="chat-same-check"><input type="checkbox" id="sameAsWork"/><span>Same as work location</span></label>'
      : '';

    chatFooter.innerHTML =
      '<div class="chat-dropdown-wrap" id="dropdownWrap">' +
        '<div class="chat-dropdown-list" id="dropdownList"></div>' +
        '<div class="chat-input-row">' +
          '<div class="chat-dropdown-input-wrap">' +
            '<span class="material-symbols-outlined chat-dropdown-icon">search</span>' +
            '<input type="text" class="chat-text-input chat-text-input--search" id="chatSearchInput" placeholder="' + placeholder + '" autocomplete="off"/>' +
          '</div>' +
          '<button type="button" class="btn-send" id="btnSend" disabled>' +
            '<span class="material-symbols-outlined">send</span>' +
          '</button>' +
        '</div>' +
        sameHTML +
      '</div>' + privacyHTML();

    var searchInput = document.getElementById('chatSearchInput');
    var list = document.getElementById('dropdownList');
    var btnSend = document.getElementById('btnSend');
    var selectedValue = '';

    setTimeout(function () { searchInput.focus(); }, 100);

    function renderList(query) {
      if (!query) {
        list.style.display = 'none';
        return;
      }
      var filtered = cityData.filter(function (item) {
        return cityDataMatches(item, query);
      });
      if (!filtered.length) {
        list.style.display = 'none';
        return;
      }
      filtered.sort(function (a, b) {
        var diff = rankLocItem(b, query) - rankLocItem(a, query);
        if (diff !== 0) return diff;
        return (a.label || '').localeCompare(b.label || '');
      });
      list.innerHTML = '';
      filtered.slice(0, 12).forEach(function (item) {
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'chat-dropdown-item';
        btn.textContent = item.label;
        btn.addEventListener('click', function () {
          searchInput.value = item.label;
          selectedValue = item.label;
          list.style.display = 'none';
          btnSend.disabled = false;
          searchInput.blur();
        });
        list.appendChild(btn);
      });
      list.style.display = 'block';
      scrollToBottom();
    }

    searchInput.addEventListener('input', function () {
      selectedValue = '';
      btnSend.disabled = true;
      renderList(searchInput.value.trim());
    });

    function submitDropdown() {
      if (!selectedValue) {
        var resolved = resolveLocationInput(searchInput.value.trim());
        if (!resolved) return;
        selectedValue = resolved;
      }
      handleAnswer(selectedValue);
    }

    btnSend.addEventListener('click', submitDropdown);
    searchInput.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') submitDropdown();
    });

    if (showSame) {
      var sameCheck = document.getElementById('sameAsWork');
      sameCheck.addEventListener('change', function () {
        if (sameCheck.checked && answers.workLocation) {
          searchInput.value = answers.workLocation;
          selectedValue = answers.workLocation;
          searchInput.disabled = true;
          btnSend.disabled = false;
          list.style.display = 'none';
        } else {
          searchInput.value = '';
          selectedValue = '';
          searchInput.disabled = false;
          btnSend.disabled = true;
        }
      });
    }
  }

  /* ---- Flow Control ---- */

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
    if (step.key === 'name') value = capitalizeName(value);
    answers[step.key] = value;

    var display = (step.inputType === 'slider')
      ? value + ' days'
      : (step.inputType === 'chips' ? labelForValue(step.key, value) : value);
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
      addBotMessage(msg, step.accent, function () {
        if (step.final) {
          answers.weeklyOff      = answers.weeklyOff || 'sat-sun';
          answers.pendingLeaves  = parseInt(answers.pendingLeaves, 10) || 0;
          answers.annualLeaves   = answers.pendingLeaves;
          answers.lastUpdated = new Date().toISOString();
          localStorage.setItem('holidayHacker_user', JSON.stringify(answers));
          localStorage.setItem('holidayHacker_calSetup', '1');
          setTimeout(function () {
            page.classList.add('page--leaving');
            setTimeout(function () {
              window.location.href = 'calendar/index.html';
            }, 550);
          }, 3800);
        } else {
          currentStep++;
          processStep();
        }
      });
    } else if (step.type === 'input') {
      addBotMessage(botMsg, false, function () {
        if (step.inputType === 'text') showTextInput(step.placeholder);
        else if (step.inputType === 'chips') showChips(step.options);
        else if (step.inputType === 'dropdown') showDropdown(step.placeholder, step.showSameOption);
        else if (step.inputType === 'slider') showSlider();
      });
    }
  }

  /* ---- Bootstrap ---- */

  function loadCityData() {
    fetch('database/state-city/data.json')
      .then(function (res) { return res.json(); })
      .then(function (data) {
        CITY_ALIAS_MAP = data.aliases || {};
        data.states.forEach(function (state) {
          cityData.push({ city: state.name, state: '', label: state.name, slugNorm: '', major: false });
          state.cities.forEach(function (city) {
            var cityName = typeof city === 'string' ? city : (city && city.name) || '';
            var slug = (city && typeof city === 'object' && city.slug) ? city.slug : '';
            var slugNorm = slug ? normalizeText(slug) : '';
            var major = !!(city && typeof city === 'object' && city.is_major_city);
            cityData.push({
              city: cityName,
              state: state.name,
              label: cityName + ', ' + state.name,
              slugNorm: slugNorm,
              major: major
            });
          });
        });
        processStep();
      })
      .catch(function () {
        processStep();
      });
  }

  loadCityData();
})();
