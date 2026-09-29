(function () {
  'use strict';

  const host = window.location.hostname;
  if (host !== 'chatgpt.com' && host !== 'chat.openai.com') return;

  const config = {
    chatItemSelector: 'nav a[href^="/c/"]',
    storageKey: 'chatcompost_chatgpt_checked',
    extractId: (el) => {
      const href = el.getAttribute('href');
      return href && href.startsWith('/c/') ? href.substring(3) : null;
    }
  };

  let floatingButton = null;
  let isDeleting = false;
  let accessToken = null;
  let isRestoringState = false; // Flag to prevent saving state during restoration

  console.log('[ChatCompost] Extension loaded on ChatGPT');

  // Get access token from the ChatGPT session
  async function getAccessToken() {
    if (accessToken) return accessToken;

    try {
      const response = await fetch('https://chatgpt.com/api/auth/session', {
        method: 'GET',
        credentials: 'include'
      });

      if (!response.ok) {
        throw new Error(`Session request failed: ${response.status}`);
      }

      const data = await response.json();
      accessToken = data.accessToken;
      console.log('[ChatCompost] Got access token');
      return accessToken;
    } catch (error) {
      console.error('[ChatCompost] Failed to get access token:', error);
      throw error;
    }
  }

  // Delete a conversation via the ChatGPT API.
  async function deleteConversation(conversationId) {
    const token = await getAccessToken();

    const response = await fetch(`https://chatgpt.com/backend-api/conversation/${conversationId}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      credentials: 'include',
      body: JSON.stringify({ is_visible: false })
    });

    if (!response.ok) {
      throw new Error(`Delete failed: ${response.status}`);
    }

    const result = await response.json();
    return result.success;
  }

  // Extract conversation ID from element
  function getConversationId(chatLink) {
    return config.extractId(chatLink);
  }

  // Get a unique identifier for a chat link (for state persistence)
  function getChatIdentifier(chatLink) {
    const id = config.extractId(chatLink);
    if (id) return id;

    // Fallback to href or text content
    const href = chatLink.getAttribute('href');
    return href || chatLink.textContent.trim().substring(0, 50);
  }

  // Save checked state to sessionStorage
  function saveCheckedState() {
    // Don't save if we're in the middle of restoring
    if (isRestoringState) return;

    const checkedIds = [];
    document.querySelectorAll('.bulk-delete-checkbox:checked').forEach((checkbox) => {
      const chatLink = checkbox.closest(config.chatItemSelector);
      if (chatLink) {
        const id = getChatIdentifier(chatLink);
        if (id) {
          checkedIds.push(id);
        }
      }
    });

    // Get current saved state
    const currentSaved = sessionStorage.getItem(config.storageKey);
    let currentIds = [];
    try {
      if (currentSaved) {
        currentIds = JSON.parse(currentSaved);
      }
    } catch (e) {
      // Ignore
    }

    const hasCheckboxes = document.querySelectorAll('.bulk-delete-checkbox').length > 0;
    const hasCheckedItems = checkedIds.length > 0;
    const hadCheckedItems = currentIds.length > 0;

    if (!hasCheckboxes) {
      // During navigation, checkboxes might not be visible - preserve existing state
      return;
    }

    // Only save if we have checked items OR if user explicitly unchecked everything
    if (hasCheckedItems || (hadCheckedItems && !hasCheckedItems)) {
      sessionStorage.setItem(config.storageKey, JSON.stringify(checkedIds));
    }
  }

  // Restore checked state from sessionStorage
  function restoreCheckedState() {
    try {
      const saved = sessionStorage.getItem(config.storageKey);
      if (!saved) return;

      const checkedIds = JSON.parse(saved);
      const chatItems = findChatItems();

      chatItems.forEach((chatLink) => {
        const identifier = getChatIdentifier(chatLink);
        if (checkedIds.includes(identifier)) {
          const checkbox = chatLink.querySelector('.bulk-delete-checkbox');
          if (checkbox && !checkbox.checked) {
            checkbox.checked = true;
          }
        }
      });

      updateFloatingButton();
    } catch (e) {
      console.error('[ChatCompost] Failed to restore state:', e);
    }
  }

  // Find all chat conversation links in the sidebar.
  function findChatItems() {
    return document.querySelectorAll(config.chatItemSelector);
  }

  // Create and inject a checkbox for a chat item.
  function injectCheckbox(chatLink) {
    let checkbox = chatLink.querySelector('.bulk-delete-checkbox');
    const identifier = getChatIdentifier(chatLink);

    // Check saved state
    let shouldBeChecked = false;
    try {
      const saved = sessionStorage.getItem(config.storageKey);
      if (saved) {
        const checkedIds = JSON.parse(saved);
        shouldBeChecked = checkedIds.includes(identifier);
      }
    } catch (e) {
      // Ignore errors
    }

    if (!checkbox) {
      // Create new checkbox
      checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.className = 'bulk-delete-checkbox';

      // Set checked state BEFORE adding event listeners
      checkbox.checked = shouldBeChecked;

      checkbox.addEventListener('click', (e) => {
        e.stopPropagation();
      });

      checkbox.addEventListener('change', () => {
        if (!isRestoringState) {
          saveCheckedState();
          updateFloatingButton();
        }
      });

      chatLink.addEventListener('click', (e) => {
        if (e.target.classList.contains('bulk-delete-checkbox')) {
          e.preventDefault();
          e.stopPropagation();
        }
      });

      // Keep the checkbox out of the app's flex/grid layout. Pinned rows can
      // distribute their children across the full width of the sidebar.
      if (!chatLink.hasAttribute('data-bulk-delete-checkbox')) {
        const padding = getComputedStyle(chatLink).paddingInlineStart || '0px';
        chatLink.style.setProperty('--chatcompost-original-padding', padding);
        chatLink.setAttribute('data-bulk-delete-checkbox', '');
      }
      chatLink.insertBefore(checkbox, chatLink.firstChild);
    } else {
      // A sidebar row can be reused for a different conversation.
      checkbox.checked = shouldBeChecked;
    }

    return checkbox;
  }

  function injectAllCheckboxes() {
    // Set flag to prevent saving during restoration
    isRestoringState = true;

    const chatItems = findChatItems();

    chatItems.forEach(injectCheckbox);

    // Update button after all checkboxes are processed
    updateFloatingButton();

    isRestoringState = false;
  }

  function getSelectedChats() {
    const checkboxes = document.querySelectorAll('.bulk-delete-checkbox:checked');
    return Array.from(checkboxes).map((cb) => {
      return cb.closest(config.chatItemSelector);
    }).filter(Boolean);
  }

  function createFloatingButton() {
    if (floatingButton) return;

    floatingButton = document.createElement('div');
    floatingButton.id = 'bulk-delete-floating-btn';
    floatingButton.innerHTML = `
      <button id="bulk-delete-btn">
        <span id="bulk-delete-count">0</span> Delete Selected
      </button>
    `;
    document.body.appendChild(floatingButton);

    document.getElementById('bulk-delete-btn').addEventListener('click', handleDeleteClick);
    updateFloatingButton();
  }

  function updateFloatingButton() {
    const count = document.querySelectorAll('.bulk-delete-checkbox:checked').length;
    const countEl = document.getElementById('bulk-delete-count');
    const btnContainer = document.getElementById('bulk-delete-floating-btn');

    if (countEl) countEl.textContent = count;
    if (btnContainer) {
      btnContainer.style.display = count > 0 ? 'flex' : 'none';
    }
  }

  async function handleDeleteClick() {
    if (isDeleting) return;

    const selectedChats = getSelectedChats();
    if (selectedChats.length === 0) return;

    if (!confirm(`Delete ${selectedChats.length} ChatGPT conversation(s)? This cannot be undone.`)) return;

    isDeleting = true;
    const btn = document.getElementById('bulk-delete-btn');
    btn.disabled = true;

    let successCount = 0;
    let failCount = 0;

    for (let i = 0; i < selectedChats.length; i++) {
      const chatLink = selectedChats[i];
      const conversationId = getConversationId(chatLink);

      if (!conversationId) {
        console.log(`[ChatCompost] Could not get conversation ID for chat ${i + 1}`);
        failCount++;
        continue;
      }

      btn.textContent = `Deleting ${i + 1}/${selectedChats.length}...`;

      try {
        await deleteConversation(conversationId);
        console.log(`[ChatCompost] Deleted conversation: ${conversationId}`);
        successCount++;

        // Mark as deleted visually
        chatLink.style.textDecoration = 'line-through';
        chatLink.style.opacity = '0.5';

        // Uncheck the checkbox
        const checkbox = chatLink.querySelector('.bulk-delete-checkbox');
        if (checkbox) checkbox.checked = false;

        // Update saved state
        saveCheckedState();

      } catch (error) {
        console.error(`[ChatCompost] Failed to delete:`, error.message);
        failCount++;
      }

      // Delay between deletions.
      await new Promise(r => setTimeout(r, 300));
    }

    console.log(`[ChatCompost] Done. Success: ${successCount}, Failed: ${failCount}`);

    if (failCount > 0) {
      alert(`Deleted ${successCount} conversations. ${failCount} failed. Refreshing...`);
    }

    // Clear saved state after successful deletion
    sessionStorage.removeItem(config.storageKey);

    // Auto-refresh the page to show updated sidebar
    setTimeout(() => {
      window.location.reload();
    }, 500);
  }

  function setupObserver() {
    let timeoutId = null;
    const options = {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['href']
    };
    const itemSelector = config.chatItemSelector;

    function containsChat(node) {
      return node.nodeType === Node.ELEMENT_NODE && (
        node.matches(itemSelector) ||
        node.querySelector(itemSelector) ||
        node.matches('.bulk-delete-checkbox') ||
        node.querySelector('.bulk-delete-checkbox')
      );
    }

    const observer = new MutationObserver((mutations) => {
      const chatsChanged = mutations.some((mutation) => {
        const target = mutation.target;
        if (target.nodeType === Node.ELEMENT_NODE && (
          target.closest(itemSelector) || containsChat(target)
        )) return true;

        return [...mutation.addedNodes, ...mutation.removedNodes].some(containsChat);
      });
      if (!chatsChanged || timeoutId !== null) return;

      // Batch updates without postponing them indefinitely while the page changes.
      timeoutId = setTimeout(() => {
        timeoutId = null;
        // Ignore only our own synchronous DOM writes. Resume immediately so
        // newly loaded chats never fall into a timed observation blind spot.
        observer.disconnect();
        try {
          injectAllCheckboxes();
        } finally {
          isRestoringState = false;
          observer.observe(document.body, options);
        }
      }, 150);
    });

    // The app can have several navigation sections and replace the entire
    // sidebar during navigation. Observe a stable ancestor of all of them.
    observer.observe(document.body, options);
  }

  function init() {
    setTimeout(() => {
      console.log('[ChatCompost] Initializing on ChatGPT...');

      injectAllCheckboxes();
      createFloatingButton();
      setupObserver();

      // Save state before page unloads
      window.addEventListener('beforeunload', () => {
        saveCheckedState();
      });

      // Save state when visibility changes
      document.addEventListener('visibilitychange', () => {
        if (document.hidden) {
          saveCheckedState();
        }
      });

      // Periodic state save
      setInterval(() => {
        saveCheckedState();
      }, 2000);

      console.log('[ChatCompost] Initialized on ChatGPT');
    }, 1500);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
