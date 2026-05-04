(function () {
  "use strict";

  // ============ 상수 ============
  const API_BASE = (window.EMCO_API_BASE || "/api").replace(/\/$/, "");
  const API_CHAT = `${API_BASE}/patient-chatbot/chat`;
  const SESSION_KEY = "emco_chat_session";
  const SESSION_TTL_MS = 1000 * 60 * 60 * 6; // 6시간
  const HISTORY_TURNS = 10;
  const SOURCE_MARKER = "__SOURCES__";
  const ADDRESS = "서울 중랑구 망우로 353 C동 308호 (상봉동, 현대프리미어스엠코)";

  // ============ DOM 참조 ============
  const header = document.getElementById("site-header");
  const mobileMenu = document.getElementById("mobile-menu");
  const hamburgerIcon = document.getElementById("hamburger-icon");
  const widget = document.getElementById("chat-widget");
  const backdrop = document.getElementById("chat-backdrop");
  const fab = document.getElementById("chat-fab");
  const fabIcon = document.getElementById("fab-icon");
  const fabPulse = document.getElementById("fab-pulse");
  const chatBody = document.getElementById("chat-body");
  const chatInput = document.getElementById("chat-input");
  const sendBtn = document.getElementById("chat-send-btn");
  const suggestedBlock = document.getElementById("suggested-block");

  // ============ 상태 ============
  let mobileOpen = false;
  let chatOpen = false;
  let sending = false;
  let suggestedRemoved = false;
  /** @type {{ role: 'user' | 'model', content: string }[]} */
  let history = [];
  let sessionId = restoreSession();

  // ============ 헤더 스크롤 ============
  const onScroll = () => {
    if (window.scrollY > 24) header.classList.add("scrolled");
    else header.classList.remove("scrolled");
  };
  window.addEventListener("scroll", onScroll, { passive: true });
  onScroll();

  // ============ 모바일 메뉴 ============
  function setMobileMenu(open) {
    mobileOpen = open;
    mobileMenu.style.display = open ? "flex" : "none";
    mobileMenu.hidden = !open;
    hamburgerIcon.firstElementChild.setAttribute("href", open ? "#i-close" : "#i-menu");
  }
  setMobileMenu(false);
  mobileMenu.querySelectorAll("a").forEach((a) => a.addEventListener("click", () => setMobileMenu(false)));

  // ============ 챗봇 모달 열기/닫기 ============
  function setChatOpen(open) {
    chatOpen = open;
    widget.hidden = !open;
    backdrop.hidden = !open;
    document.body.style.overflow = open ? "hidden" : "";
    if (open) {
      fab.classList.add("open");
      fabIcon.firstElementChild.setAttribute("href", "#i-close");
      fabIcon.setAttribute("width", "22");
      fabIcon.setAttribute("height", "22");
      fabPulse.style.display = "none";
      setTimeout(() => chatInput.focus(), 80);
    } else {
      fab.classList.remove("open");
      fabIcon.firstElementChild.setAttribute("href", "#mascot-face");
      fabIcon.setAttribute("width", "42");
      fabIcon.setAttribute("height", "42");
      fabPulse.style.display = "";
    }
  }

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && chatOpen) setChatOpen(false);
  });

  // 닫기 버튼은 위임 외에 직접 리스너로 한 번 더 보장 (SVG <use> closest() edge case 회피)
  document.querySelectorAll('[data-action="close-chat"]').forEach((el) => {
    el.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      setChatOpen(false);
    });
  });

  // ============ 세션 저장 / 복원 ============
  function restoreSession() {
    try {
      const raw = sessionStorage.getItem(SESSION_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (Date.now() - parsed.ts > SESSION_TTL_MS) {
        sessionStorage.removeItem(SESSION_KEY);
        return null;
      }
      if (Array.isArray(parsed.history)) history = parsed.history;
      return parsed.sessionId || null;
    } catch {
      return null;
    }
  }
  function persistSession() {
    try {
      sessionStorage.setItem(
        SESSION_KEY,
        JSON.stringify({ sessionId, history: history.slice(-HISTORY_TURNS * 2), ts: Date.now() }),
      );
    } catch {}
  }

  // ============ 메시지 렌더 헬퍼 ============
  function escapeHtml(s) {
    return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  function appendUserMessage(text) {
    if (!suggestedRemoved && suggestedBlock) {
      suggestedBlock.remove();
      suggestedRemoved = true;
    }
    const row = document.createElement("div");
    row.className = "bubble-row user";
    row.innerHTML = `<div class="bubble-wrap"><div class="bubble user">${escapeHtml(text)}</div></div>`;
    chatBody.appendChild(row);
    scrollToBottom();
  }

  function appendBotPlaceholder() {
    const row = document.createElement("div");
    row.className = "bubble-row bot";
    row.innerHTML = `
      <div class="bubble-avatar"><svg width="28" height="28"><use href="#mascot-face"/></svg></div>
      <div class="bubble-wrap">
        <div class="bubble-name">코코</div>
        <div class="bubble bot typing"><span></span><span></span><span></span></div>
      </div>`;
    chatBody.appendChild(row);
    scrollToBottom();
    return row;
  }

  function setBotContent(row, text) {
    const bubble = row.querySelector(".bubble");
    if (!bubble) return;
    bubble.classList.remove("typing");
    bubble.textContent = text;
    scrollToBottom();
  }

  function appendSourcesToBubble(row, sources) {
    if (!sources || sources.length === 0) return;
    const bubble = row.querySelector(".bubble");
    if (!bubble) return;
    const div = document.createElement("div");
    div.className = "bubble-source";
    for (const s of sources) {
      const chip = document.createElement(s.url ? "a" : "span");
      chip.className = "source-chip";
      if (s.url) {
        chip.href = s.url;
        chip.target = "_blank";
        chip.rel = "noopener";
      }
      const label = s.sourceType === "pubmed" ? "📖" : s.sourceType === "script" ? "💬" : "🌷";
      chip.textContent = `${label} ${s.title}`;
      div.appendChild(chip);
    }
    bubble.appendChild(div);
    scrollToBottom();
  }

  function scrollToBottom() {
    chatBody.scrollTop = chatBody.scrollHeight;
  }

  // ============ 스트리밍 응답 파싱 ============
  function splitContentAndSources(text) {
    const idx = text.indexOf(SOURCE_MARKER);
    if (idx < 0) return { content: text, sources: null };
    const content = text.slice(0, idx).trim();
    const json = text.slice(idx + SOURCE_MARKER.length).trim();
    try {
      const sources = JSON.parse(json);
      return { content, sources: Array.isArray(sources) ? sources : null };
    } catch {
      return { content, sources: null };
    }
  }

  // ============ 메시지 전송 ============
  async function sendMessage(text) {
    const trimmed = (text == null ? chatInput.value : text).trim();
    if (!trimmed || sending) return;
    sending = true;
    sendBtn.disabled = true;
    chatInput.value = "";

    appendUserMessage(trimmed);
    const botRow = appendBotPlaceholder();

    try {
      const res = await fetch(API_CHAT, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "text/plain" },
        body: JSON.stringify({
          query: trimmed,
          category: "auto",
          history: history.slice(-HISTORY_TURNS),
          sessionId,
        }),
      });

      const newSessionId = res.headers.get("X-Session-Id");
      if (newSessionId) sessionId = newSessionId;

      if (!res.ok) {
        setBotContent(botRow, `요청을 처리하지 못했어요. (${res.status})\n잠시 후 다시 시도해 주세요.`);
        return;
      }

      const reader = res.body && res.body.getReader();
      if (!reader) {
        const fallback = await res.text();
        const parsed = splitContentAndSources(fallback);
        setBotContent(botRow, parsed.content);
        appendSourcesToBubble(botRow, parsed.sources);
        history.push({ role: "user", content: trimmed });
        history.push({ role: "model", content: parsed.content });
        persistSession();
        return;
      }

      const decoder = new TextDecoder();
      let full = "";
      let lastDisplay = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        full += decoder.decode(value, { stream: true });
        const idx = full.indexOf(SOURCE_MARKER);
        const display = (idx < 0 ? full : full.slice(0, idx)).trim();
        if (display && display !== lastDisplay) {
          setBotContent(botRow, display);
          lastDisplay = display;
        }
      }

      const parsed = splitContentAndSources(full);
      if (parsed.content) setBotContent(botRow, parsed.content);
      appendSourcesToBubble(botRow, parsed.sources);

      history.push({ role: "user", content: trimmed });
      history.push({ role: "model", content: parsed.content });
      persistSession();
    } catch (err) {
      console.error("[chat] error:", err);
      setBotContent(
        botRow,
        "잠시 통신이 어려웠어요. 잠시 후 다시 시도해 주시거나 02-433-5275 로 전화 주세요.",
      );
    } finally {
      sending = false;
      sendBtn.disabled = false;
      chatInput.focus();
    }
  }

  // ============ 입력 ============
  chatInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });

  // ============ 주소 복사 ============
  async function copyAddress() {
    try {
      await navigator.clipboard.writeText(ADDRESS);
      alert("주소가 복사되었어요! 🌷");
    } catch {
      const ta = document.createElement("textarea");
      ta.value = ADDRESS;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      alert("주소가 복사되었어요! 🌷");
    }
  }

  // ============ 위임 클릭 핸들러 ============
  document.addEventListener("click", (e) => {
    // suggested chip / quick-action — 둘 다 data-suggested 로 처리
    const sug = e.target.closest("[data-suggested]");
    if (sug) {
      const q = sug.dataset.suggested;
      if (q) {
        if (!chatOpen) setChatOpen(true);
        sendMessage(q);
      }
      return;
    }

    const trigger = e.target.closest("[data-action]");
    if (!trigger) return;
    const action = trigger.dataset.action;
    switch (action) {
      case "open-chat":
        setChatOpen(true);
        break;
      case "close-chat":
        setChatOpen(false);
        break;
      case "toggle-chat":
        setChatOpen(!chatOpen);
        break;
      case "toggle-mobile-menu":
        setMobileMenu(!mobileOpen);
        break;
      case "send-chat":
        sendMessage();
        break;
      case "copy-address":
        e.preventDefault();
        copyAddress();
        break;
    }
  });
})();
