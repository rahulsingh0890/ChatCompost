(function () {
  'use strict';

  // Platform detection
  const PLATFORM = (function detectPlatform() {
    const host = window.location.hostname;
    if (host.includes('chatgpt.com') || host.includes('chat.openai.com')) {
      return 'chatgpt';
    }
    if (host.includes('gemini.google.com')) {
      return 'gemini';
    }
    return null;
  })();

  // Exit if unsupported platform
  if (!PLATFORM) {
    console.log('[ChatCompost] Unsupported platform, exiting');
    return;
  }

  // Platform-specific configurations
  const PLATFORMS = {
    chatgpt: {
      sidebarSelector: 'nav',
      chatItemSelector: 'nav a[href^="/c/"]',
      storageKey: 'chatcompost_chatgpt_checked',
      accentColor: '#10a37f',  // OpenAI green
      extractId: (el) => {
        const href = el.getAttribute('href');
        return href && href.startsWith('/c/') ? href.substring(3) : null;
      },
      deleteMethod: 'api'
    },
    gemini: {
      sidebarSelector: 'body',  // Observe entire body for Gemini
      // Multiple selectors to try - Gemini's DOM varies
      chatItemSelectors: [
        'div[data-test-id="conversation"]',
        '.conversation-item',
        'a[href*="/app/"][href*="c/"]',
        'side-navigation-v2 a',
        'side-navigation a'
      ],
      chatItemSelector: 'div[data-test-id="conversation"], .conversation-item, a[href*="/app/"]',
      storageKey: 'chatcompost_gemini_checked',
      accentColor: '#4285f4',  // Google blue
      extractId: (el) => {
        // Try href first
        const href = el.getAttribute('href') || el.querySelector('a')?.getAttribute('href');
        if (href) {
          const match = href.match(/\/app\/([^/?]+)/);
          if (match) return match[1];
        }
        // Try data attributes
        const testId = el.getAttribute('data-test-id');
        if (testId && testId !== 'conversation') return testId;
        // Fallback to text content hash
        return el.textContent?.trim().substring(0, 50);
      },
      deleteMethod: 'ui'
    }
  };

  const config = PLATFORMS[PLATFORM];

  let floatingButton = null;
  let isDeleting = false;
  let accessToken = null;
  let isRestoringState = false; // Flag to prevent saving state during restoration

  console.log(`[ChatCompost] Extension loaded on ${PLATFORM}`);

  // Add platform class to body for CSS targeting
  document.body.classList.add(`chatcompost-${PLATFORM}`);

  // Get access token from ChatGPT session (ChatGPT only)
  async function getAccessToken() {
    if (PLATFORM !== 'chatgpt') return null;
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

  // Wait for element to appear in DOM (for Gemini UI automation)
  async function waitForElement(selector, timeout = 3000) {
    return new Promise((resolve, reject) => {
      const el = document.querySelector(selector);
      if (el) return resolve(el);

      const observer = new MutationObserver(() => {
        const found = document.querySelector(selector);
        if (found) {
          observer.disconnect();
          resolve(found);
        }
      });

      observer.observe(document.body, { childList: true, subtree: true });
      setTimeout(() => {
        observer.disconnect();
        reject(new Error(`Timeout waiting for: ${selector}`));
      }, timeout);
    });
  }

  // Find element by text content
  function findElementByText(selector, text) {
    const elements = document.querySelectorAll(selector);
    for (const el of elements) {
      if (el.textContent.toLowerCase().includes(text.toLowerCase())) {
        return el;
      }
    }
    return null;
  }

  // Wait for element in overlay container (for Gemini menus/dialogs)
  function waitForOverlayElement(selector, timeout = 5000) {
    return new Promise((resolve, reject) => {
      const overlayDiv = document.querySelector('div.cdk-overlay-container');
      if (!overlayDiv) {
        return reject(new Error('Overlay container not found'));
      }

      // Check if element already exists
      const existing = overlayDiv.querySelector(selector);
      if (existing) {
        return resolve(existing);
      }

      const observer = new MutationObserver(() => {
        const el = overlayDiv.querySelector(selector);
        if (el) {
          observer.disconnect();
          resolve(el);
        }
      });

      observer.observe(overlayDiv, { subtree: true, childList: true });

      setTimeout(() => {
        observer.disconnect();
        reject(new Error(`Timeout waiting for overlay element: ${selector}`));
      }, timeout);
    });
  }

  // Wait for element to disappear
  function waitForElementToDisappear(selector, timeout = 5000) {
    return new Promise((resolve) => {
      const check = () => {
        const el = document.querySelector(selector);
        if (!el) {
          resolve();
          return;
        }
        setTimeout(check, 100);
      };
      check();
      setTimeout(resolve, timeout); // Resolve anyway after timeout
    });
  }

  // Delete via UI automation (for Gemini)
  async function deleteViaUI(chatElement) {
    try {
      // 1. Hover to reveal menu button
      chatElement.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
      await new Promise(r => setTimeout(r, 300));

      // 2. Find the three-dot actions button
      // The structure is: checkbox is in conversation div, actions button is in sibling element
      // Try to find button in next sibling first (based on working extension pattern)
      let actionsBtn = null;

      // Method 1: Look in next sibling element
      if (chatElement.nextElementSibling) {
        actionsBtn = chatElement.nextElementSibling.querySelector('button');
      }

      // Method 2: Look within the element itself
      if (!actionsBtn) {
        const buttons = chatElement.querySelectorAll('button');
        for (const btn of buttons) {
          // Skip if it's a known non-menu button
          if (btn.closest('.bulk-delete-checkbox')) continue;
          actionsBtn = btn;
          break;
        }
      }

      // Method 3: Look in parent's children for actions container
      if (!actionsBtn && chatElement.parentElement) {
        const siblings = chatElement.parentElement.children;
        for (const sibling of siblings) {
          if (sibling !== chatElement) {
            const btn = sibling.querySelector('button');
            if (btn) {
              actionsBtn = btn;
              break;
            }
          }
        }
      }

      if (!actionsBtn) {
        throw new Error('Actions menu button not found');
      }

      console.log('[ChatCompost] Clicking actions button...');
      actionsBtn.click();

      // 3. Wait for delete button to appear in overlay
      console.log('[ChatCompost] Waiting for delete button in overlay...');
      const deleteBtn = await waitForOverlayElement('button[data-test-id="delete-button"]');

      await new Promise(r => setTimeout(r, 200));
      console.log('[ChatCompost] Clicking delete button...');
      deleteBtn.click();

      // 4. Wait for confirm button to appear
      console.log('[ChatCompost] Waiting for confirm button...');
      const confirmBtn = await waitForOverlayElement('button[data-test-id="confirm-button"]');

      await new Promise(r => setTimeout(r, 200));
      console.log('[ChatCompost] Clicking confirm button...');
      confirmBtn.click();

      // 5. Wait for confirmation to complete
      await new Promise(r => setTimeout(r, 500));
      console.log('[ChatCompost] Delete completed');

      return { success: true };
    } catch (error) {
      console.error('[ChatCompost] UI automation error:', error);
      throw error;
    }
  }

  // Delete a conversation via API (ChatGPT) or UI (Gemini)
  async function deleteConversation(conversationId, chatElement) {
    if (config.deleteMethod === 'api') {
      // ChatGPT API deletion
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
    } else {
      // Gemini UI automation
      return await deleteViaUI(chatElement);
    }
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
      const chatLink = checkbox.closest(config.chatItemSelector.split(',')[0].trim()) ||
                       checkbox.closest('a');
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

  // Find all chat conversation links in the sidebar
  function findChatItems() {
    let items = document.querySelectorAll(config.chatItemSelector);

    // For Gemini, try multiple selectors if the main one fails
    if (PLATFORM === 'gemini' && items.length === 0 && config.chatItemSelectors) {
      for (const selector of config.chatItemSelectors) {
        items = document.querySelectorAll(selector);
        if (items.length > 0) {
          console.log(`[ChatCompost] Found ${items.length} items with selector: ${selector}`);
          break;
        }
      }
    }

    // Debug: log what we found
    if (items.length === 0) {
      console.log('[ChatCompost] No chat items found. Trying to detect sidebar structure...');
      // Log some potential containers to help debug
      const potentialContainers = [
        'side-navigation', 'side-navigation-v2', '[role="navigation"]',
        'nav', '.sidebar', '[class*="sidebar"]', '[class*="conversation"]'
      ];
      potentialContainers.forEach(sel => {
        const el = document.querySelector(sel);
        if (el) {
          console.log(`[ChatCompost] Found container: ${sel}`, el.tagName, el.className);
          // Log first few children
          const children = el.querySelectorAll('a, div[class*="conversation"], li');
          console.log(`[ChatCompost]   Children (a, div, li): ${children.length}`);
          if (children.length > 0 && children.length < 10) {
            children.forEach((c, i) => console.log(`[ChatCompost]   Child ${i}:`, c.tagName, c.className, c.getAttribute('href')?.substring(0, 50)));
          }
        }
      });
    } else {
      console.log(`[ChatCompost] Found ${items.length} chat items`);
    }

    return items;
  }

  // Check if element is a real conversation (not New chat, My Stuff, Gems, etc.)
  function isActualConversation(element) {
    const text = element.textContent?.trim().toLowerCase() || '';

    // List of non-conversation items to exclude
    const excludeTexts = [
      'new chat',
      'my stuff',
      'gems',
      'settings',
      'help',
      'updates',
      'activity'
    ];

    // Check if text matches any excluded item
    for (const exclude of excludeTexts) {
      if (text === exclude || text.startsWith(exclude + ' ')) {
        return false;
      }
    }

    // Also exclude if it has chevron/arrow indicating a menu section (not a chat)
    // These typically have very short text
    if (text.length < 3) {
      return false;
    }

    return true;
  }

  // Create and inject a checkbox for a chat item
  function injectCheckbox(chatLink) {
    // Skip non-conversation items (Gemini)
    if (PLATFORM === 'gemini' && !isActualConversation(chatLink)) {
      // Remove checkbox if it was previously added
      const existingCheckbox = chatLink.querySelector('.bulk-delete-checkbox');
      if (existingCheckbox) {
        existingCheckbox.remove();
      }
      return null;
    }

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

      chatLink.style.display = 'flex';
      chatLink.style.alignItems = 'center';
      chatLink.insertBefore(checkbox, chatLink.firstChild);
    } else {
      // Checkbox already exists - restore its state if needed
      if (shouldBeChecked && !checkbox.checked) {
        isRestoringState = true;
        checkbox.checked = true;
        setTimeout(() => {
          isRestoringState = false;
        }, 10);
      }
    }

    return checkbox;
  }

  function injectAllCheckboxes() {
    // Set flag to prevent saving during restoration
    isRestoringState = true;

    // Save current state BEFORE we start modifying checkboxes
    const currentChecked = [];
    document.querySelectorAll('.bulk-delete-checkbox:checked').forEach((checkbox) => {
      const chatLink = checkbox.closest(config.chatItemSelector.split(',')[0].trim()) ||
                       checkbox.closest('a');
      if (chatLink) {
        const id = getChatIdentifier(chatLink);
        if (id) {
          currentChecked.push(id);
        }
      }
    });

    // Save current state if we have checked items
    if (currentChecked.length > 0) {
      sessionStorage.setItem(config.storageKey, JSON.stringify(currentChecked));
    }

    const chatItems = findChatItems();

    // Inject checkboxes (only for actual conversations)
    let injectedCount = 0;
    chatItems.forEach((chatLink) => {
      const checkbox = injectCheckbox(chatLink);
      if (checkbox) injectedCount++;
    });

    if (PLATFORM === 'gemini') {
      console.log(`[ChatCompost] Injected ${injectedCount} checkboxes (filtered from ${chatItems.length} items)`);
    }

    // Update button after all checkboxes are processed
    updateFloatingButton();

    // Clear flag after a short delay
    setTimeout(() => {
      isRestoringState = false;
    }, 100);
  }

  function getSelectedChats() {
    const checkboxes = document.querySelectorAll('.bulk-delete-checkbox:checked');
    return Array.from(checkboxes).map((cb) => {
      return cb.closest(config.chatItemSelector.split(',')[0].trim()) || cb.closest('a');
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

    const platformName = PLATFORM === 'chatgpt' ? 'ChatGPT' : 'Gemini';
    if (!confirm(`Delete ${selectedChats.length} ${platformName} conversation(s)? This cannot be undone.`)) return;

    isDeleting = true;
    const btn = document.getElementById('bulk-delete-btn');
    const originalText = btn.innerHTML;
    btn.disabled = true;

    let successCount = 0;
    let failCount = 0;

    for (let i = 0; i < selectedChats.length; i++) {
      const chatLink = selectedChats[i];
      const conversationId = getConversationId(chatLink);

      if (!conversationId && config.deleteMethod === 'api') {
        console.log(`[ChatCompost] Could not get conversation ID for chat ${i + 1}`);
        failCount++;
        continue;
      }

      btn.textContent = `Deleting ${i + 1}/${selectedChats.length}...`;

      try {
        await deleteConversation(conversationId, chatLink);
        console.log(`[ChatCompost] Deleted conversation: ${conversationId || 'via UI'}`);
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

      // Delay between deletions (longer for UI automation)
      const delay = config.deleteMethod === 'ui' ? 800 : 300;
      await new Promise(r => setTimeout(r, delay));
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
    let isRestoring = false;

    const observer = new MutationObserver(() => {
      if (isRestoring) return;

      clearTimeout(timeoutId);
      timeoutId = setTimeout(() => {
        isRestoring = true;
        injectAllCheckboxes();

        // Retry restoration after a delay
        setTimeout(() => {
          const saved = sessionStorage.getItem(config.storageKey);
          if (saved) {
            try {
              const checkedIds = JSON.parse(saved);
              if (checkedIds.length > 0) {
                const chatItems = findChatItems();
                let anyChecked = false;
                chatItems.forEach((chatLink) => {
                  const checkbox = chatLink.querySelector('.bulk-delete-checkbox');
                  if (checkbox && checkbox.checked) {
                    anyChecked = true;
                  }
                });

                if (!anyChecked) {
                  chatItems.forEach((chatLink) => {
                    const identifier = getChatIdentifier(chatLink);
                    if (checkedIds.includes(identifier)) {
                      const checkbox = chatLink.querySelector('.bulk-delete-checkbox');
                      if (checkbox && !checkbox.checked) {
                        isRestoringState = true;
                        checkbox.checked = true;
                      }
                    }
                  });
                  updateFloatingButton();
                  setTimeout(() => {
                    isRestoringState = false;
                  }, 50);
                }
              }
            } catch (e) {
              // Ignore
            }
          }
        }, 300);

        setTimeout(() => {
          isRestoring = false;
        }, 500);
      }, 150);
    });

    // Try to find sidebar using platform-specific selectors
    const sidebarSelectors = config.sidebarSelector.split(',').map(s => s.trim());
    let sidebar = null;

    for (const selector of sidebarSelectors) {
      sidebar = document.querySelector(selector);
      if (sidebar) break;
    }

    if (sidebar) {
      observer.observe(sidebar, { childList: true, subtree: true });
      console.log(`[ChatCompost] Observing sidebar`);
    } else {
      // Fallback: observe body if sidebar not found
      observer.observe(document.body, { childList: true, subtree: true });
      console.log(`[ChatCompost] Sidebar not found, observing body`);
    }
  }

  function init() {
    // Gemini's SPA might take longer to load
    const initialDelay = PLATFORM === 'gemini' ? 2500 : 1500;

    setTimeout(() => {
      console.log(`[ChatCompost] Initializing on ${PLATFORM}...`);

      injectAllCheckboxes();
      createFloatingButton();
      setupObserver();

      // For Gemini, retry injection a few times since content loads dynamically
      if (PLATFORM === 'gemini') {
        let retryCount = 0;
        const retryInterval = setInterval(() => {
          const items = findChatItems();
          if (items.length === 0 && retryCount < 5) {
            console.log(`[ChatCompost] Retry ${retryCount + 1}: Looking for chat items...`);
            retryCount++;
          } else {
            if (items.length > 0) {
              injectAllCheckboxes();
            }
            clearInterval(retryInterval);
          }
        }, 2000);
      }

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

      console.log(`[ChatCompost] Initialized on ${PLATFORM}`);
    }, initialDelay);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
