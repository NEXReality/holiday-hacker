/* Keeps onboarding chat and location suggestions visible (incl. mobile keyboard). */
(function (global) {
  'use strict';

  var LIST_MAX = 220;
  var GAP = 6;
  var PAD = 8;
  var MIN_LIST = 72;

  function keyboardInsetPx() {
    var vv = global.visualViewport;
    if (!vv) return 0;
    return Math.max(0, Math.round(global.innerHeight - vv.height - (vv.offsetTop || 0)));
  }

  function applyKeyboardInset() {
    var inset = keyboardInsetPx();
    try {
      document.documentElement.style.setProperty('--hh-keyboard-inset', inset + 'px');
    } catch (_) {}
    return inset;
  }

  function bindChatScroll(chatArea, chatFooter) {
    var scrollTimer = null;
    var lastFooterH = 0;
    var lastKeyboardInset = 0;

    /** Scroll only the chat pane — never scrollIntoView (that shifts the whole page on mobile). */
    function doScroll() {
      if (!chatArea) return;
      var max = chatArea.scrollHeight - chatArea.clientHeight;
      chatArea.scrollTop = max > 0 ? max : chatArea.scrollHeight;
    }

    /** Extra passes while the soft keyboard animates (overlays-content keeps layout height). */
    function scrollForKeyboard() {
      applyKeyboardInset();
      doScroll();
      requestAnimationFrame(doScroll);
      setTimeout(doScroll, 60);
      setTimeout(doScroll, 180);
      setTimeout(doScroll, 360);
    }

    function scrollToBottom() {
      applyKeyboardInset();
      requestAnimationFrame(doScroll);
      if (scrollTimer) clearTimeout(scrollTimer);
      scrollTimer = setTimeout(function () {
        scrollTimer = null;
        doScroll();
      }, 120);
    }

    if (chatFooter && typeof ResizeObserver !== 'undefined') {
      var footerTimer = null;
      new ResizeObserver(function () {
        if (footerTimer) clearTimeout(footerTimer);
        footerTimer = setTimeout(function () {
          footerTimer = null;
          var h = chatFooter.offsetHeight;
          if (Math.abs(h - lastFooterH) < 8) return;
          lastFooterH = h;
          doScroll();
        }, 80);
      }).observe(chatFooter);

      chatFooter.addEventListener('focusin', function () {
        scrollForKeyboard();
      }, true);
    }

    if (global.visualViewport) {
      var vvTimer = null;
      function onViewportChange() {
        var inset = applyKeyboardInset();
        var keyboardChanged = Math.abs(inset - lastKeyboardInset) > 24;
        lastKeyboardInset = inset;

        if (vvTimer) clearTimeout(vvTimer);
        vvTimer = setTimeout(function () {
          vvTimer = null;
          if (keyboardChanged || inset > 0) {
            scrollForKeyboard();
          } else {
            doScroll();
          }
        }, 50);
      }
      global.visualViewport.addEventListener('resize', onViewportChange);
      global.visualViewport.addEventListener('scroll', onViewportChange);
    }

    global.addEventListener('resize', function () {
      applyKeyboardInset();
      doScroll();
    });

    return scrollToBottom;
  }

  function clearDropdownPosition(list) {
    if (!list) return;
    list.classList.remove('chat-dropdown-list--open');
    list.style.maxHeight = '';
  }

  /**
   * Keep suggestions anchored just above the search field (in the footer).
   * Uses in-place absolute layout — not viewport-fixed — so the list never
   * floats into the chat history or drifts when the keyboard opens.
   */
  function bindDropdownViewport(list, anchor) {
    if (!list || !anchor) return function () {};

    var chatArea = document.getElementById('chatArea')
      || document.getElementById('planChatArea')
      || document.getElementById('calChatArea');

    function positionList() {
      if (list.style.display === 'none' || list.hidden) {
        clearDropdownPosition(list);
        return;
      }

      var row = anchor.closest('.chat-input-row');
      var rowRect = row ? row.getBoundingClientRect() : anchor.getBoundingClientRect();
      var vv = global.visualViewport;
      var viewTop = vv ? vv.offsetTop : 0;
      var listBottom = rowRect.top - GAP;
      var spaceAbove = listBottom - viewTop - PAD;
      var maxH = Math.min(LIST_MAX, Math.max(MIN_LIST, spaceAbove));

      list.classList.add('chat-dropdown-list--open');
      list.style.maxHeight = maxH + 'px';

      requestAnimationFrame(function () {
        if (list.style.display === 'none') return;
        var contentH = list.scrollHeight;
        if (contentH > 0 && contentH < maxH) {
          list.style.maxHeight = contentH + 'px';
        }
      });
    }

    function schedulePosition() {
      applyKeyboardInset();
      requestAnimationFrame(positionList);
    }

    anchor.addEventListener('focus', schedulePosition);
    anchor.addEventListener('input', schedulePosition);
    anchor.addEventListener('blur', function () {
      setTimeout(function () {
        if (list.style.display === 'none') clearDropdownPosition(list);
      }, 180);
    });

    if (chatArea) {
      chatArea.addEventListener('scroll', schedulePosition, { passive: true });
    }

    list.addEventListener('touchmove', function (e) {
      e.stopPropagation();
    }, { passive: true });

    function onDropdownViewportChange() {
      applyKeyboardInset();
      schedulePosition();
    }

    if (global.visualViewport) {
      global.visualViewport.addEventListener('resize', onDropdownViewportChange);
      global.visualViewport.addEventListener('scroll', onDropdownViewportChange);
    }
    global.addEventListener('resize', onDropdownViewportChange);

    return schedulePosition;
  }

  global.HH_bindChatScroll = bindChatScroll;
  global.HH_bindDropdownViewport = bindDropdownViewport;
  global.HH_clearDropdownPosition = clearDropdownPosition;
})(typeof window !== 'undefined' ? window : this);
