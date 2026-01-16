(function () {
  'use strict';

  let floatingButton = null;
  let isDeleting = false;
  let accessToken = null;

  console.log('[BulkDeleter] Extension loaded');

  // Get access token from ChatGPT session
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
      console.log('[BulkDeleter] Got access token');
      return accessToken;
    } catch (error) {
      console.error('[BulkDeleter] Failed to get access token:', error);
      throw error;
    }
  }

  // Delete a conversation via API
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

  // Extract conversation ID from URL
  function getConversationId(chatLink) {
    const href = chatLink.getAttribute('href');
    if (href && href.startsWith('/c/')) {
      return href.substring(3); // Remove '/c/' prefix
    }
    return null;
  }

  // Find all chat conversation links in the sidebar
  function findChatItems() {
    return document.querySelectorAll('nav a[href^="/c/"]');
  }

  // Create and inject a checkbox for a chat item
  function injectCheckbox(chatLink) {
    if (chatLink.querySelector('.bulk-delete-checkbox')) {
      return;
    }

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.className = 'bulk-delete-checkbox';

    checkbox.addEventListener('click', (e) => {
      e.stopPropagation();
    });

    checkbox.addEventListener('change', () => {
      updateFloatingButton();
    });

    chatLink.addEventListener('click', (e) => {
      if (e.target.classList.contains('bulk-delete-checkbox')) {
        e.preventDefault();
        e.stopPropagation();
      }
    });

    chatLink.style.display = 'flex';
    chatLink.style.alignItems = 'center';
    chatLink.insertBefore(checkbox, chatLink.firstChild);
  }

  function injectAllCheckboxes() {
    const chatItems = findChatItems();
    chatItems.forEach(injectCheckbox);
  }

  function getSelectedChats() {
    const checkboxes = document.querySelectorAll('.bulk-delete-checkbox:checked');
    return Array.from(checkboxes).map((cb) => cb.closest('a[href^="/c/"]'));
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

    if (!confirm(`Delete ${selectedChats.length} conversation(s)? This cannot be undone.`)) return;

    isDeleting = true;
    const btn = document.getElementById('bulk-delete-btn');
    const originalText = btn.innerHTML;
    btn.disabled = true;

    let successCount = 0;
    let failCount = 0;

    for (let i = 0; i < selectedChats.length; i++) {
      const chatLink = selectedChats[i];
      const conversationId = getConversationId(chatLink);

      if (!conversationId) {
        console.log(`[BulkDeleter] Could not get conversation ID for chat ${i + 1}`);
        failCount++;
        continue;
      }

      btn.textContent = `Deleting ${i + 1}/${selectedChats.length}...`;

      try {
        await deleteConversation(conversationId);
        console.log(`[BulkDeleter] Deleted conversation: ${conversationId}`);
        successCount++;

        // Mark as deleted visually (strikethrough + gray) but don't remove
        // ChatGPT will refresh the list on its own
        chatLink.style.textDecoration = 'line-through';
        chatLink.style.opacity = '0.5';

        // Uncheck the checkbox
        const checkbox = chatLink.querySelector('.bulk-delete-checkbox');
        if (checkbox) checkbox.checked = false;

      } catch (error) {
        console.error(`[BulkDeleter] Failed to delete ${conversationId}:`, error.message);
        failCount++;

        // Keep checkbox checked for failed items so user knows which failed
      }

      // Small delay between deletions to avoid rate limiting
      await new Promise(r => setTimeout(r, 300));
    }

    console.log(`[BulkDeleter] Done. Success: ${successCount}, Failed: ${failCount}`);

    if (failCount > 0) {
      alert(`Deleted ${successCount} conversations. ${failCount} failed. Refreshing...`);
    }

    // Auto-refresh the page to show updated sidebar
    setTimeout(() => {
      window.location.reload();
    }, 500);
  }

  function setupObserver() {
    const observer = new MutationObserver(() => {
      injectAllCheckboxes();
    });

    const nav = document.querySelector('nav');
    if (nav) {
      observer.observe(nav, { childList: true, subtree: true });
    }
  }

  function init() {
    setTimeout(() => {
      injectAllCheckboxes();
      createFloatingButton();
      setupObserver();
      console.log('[BulkDeleter] Initialized');
    }, 1500);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
