// popup.js
const activateBtn = document.getElementById("activate");
const deactivateBtn = document.getElementById("deactivate");
const copyBtn = document.getElementById("copy");
const downloadBtn = document.getElementById("download");
const codeArea = document.getElementById("code");

// Connect to background script to restore any saved selections
const port = chrome.runtime.connect({ name: "popup" });
port.onMessage.addListener((msg) => {
  if (msg.action === "restore-selection" && msg.data) {
    codeArea.value = msg.data.html;
    copyBtn.disabled = false;
    downloadBtn.disabled = false;
    
    const timeAgo = Math.round((Date.now() - msg.data.timestamp) / 1000);
    const successDiv = document.createElement("div");
    successDiv.textContent = `✓ Restored selection from ${timeAgo} seconds ago`;
    successDiv.style.cssText = "color: blue; font-size: 12px; margin: 5px 0;";
    codeArea.parentNode.insertBefore(successDiv, codeArea);
    setTimeout(() => successDiv.remove(), 5000);
  }
});

// Clear badge when popup opens
chrome.tabs.query({ active: true, currentWindow: true }).then(([tab]) => {
  chrome.action.setBadgeText({ text: "", tabId: tab.id });
});

// Function to inject content script if needed
async function ensureContentScript(tabId) {
  try {
    // Try to ping the content script
    await chrome.tabs.sendMessage(tabId, { action: "ping" });
    return true;
  } catch (error) {
    // Content script not loaded, inject it
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tabId },
        files: ['content_script.js']
      });
      // Wait a bit for the script to initialize
      await new Promise(resolve => setTimeout(resolve, 100));
      return true;
    } catch (injectionError) {
      console.error("Failed to inject content script:", injectionError);
      return false;
    }
  }
}

activateBtn.addEventListener("click", async () => {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    
    // Check if we can access this tab
    if (tab.url.startsWith('chrome://') || tab.url.startsWith('chrome-extension://') || tab.url.startsWith('edge://') || tab.url.startsWith('about:')) {
      codeArea.value = "Cannot access this page. Please navigate to a regular website to use this extension.";
      return;
    }

    codeArea.value = "Preparing selection monitor...";
    
    // Ensure content script is loaded
    const scriptLoaded = await ensureContentScript(tab.id);
    if (!scriptLoaded) {
      codeArea.value = "Failed to load extension on this page. Please refresh the page and try again.";
      return;
    }

    // Start selection monitoring
    try {
      await chrome.tabs.sendMessage(tab.id, { action: "start-selection" });
      codeArea.value = "Selection monitor activated! Go to the webpage and select any text or element...";
      activateBtn.disabled = true;
      deactivateBtn.disabled = false;
    } catch (messageError) {
      codeArea.value = "Failed to communicate with the webpage. Please refresh the page and try again.";
      console.error("Message sending failed:", messageError);
    }
  } catch (error) {
    codeArea.value = "Error: " + error.message;
    console.error("Activation failed:", error);
  }
});

deactivateBtn.addEventListener("click", async () => {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    
    try {
      await chrome.tabs.sendMessage(tab.id, { action: "stop-selection" });
    } catch (error) {
      // Ignore errors when deactivating
      console.log("Deactivation message failed (tab may have been refreshed):", error);
    }
    
    activateBtn.disabled = false;
    deactivateBtn.disabled = true;
    codeArea.value = "Selection monitor deactivated.";
    copyBtn.disabled = true;
    downloadBtn.disabled = true;
  } catch (error) {
    console.error("Deactivation failed:", error);
    // Still update UI even if message failed
    activateBtn.disabled = false;
    deactivateBtn.disabled = true;
    codeArea.value = "Selection monitor deactivated.";
    copyBtn.disabled = true;
    downloadBtn.disabled = true;
  }
});

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.action === "selection-done" && msg.html) {
    codeArea.value = msg.html;
    copyBtn.disabled = false;
    downloadBtn.disabled = false;
    
    // Show success notification
    const successDiv = document.createElement("div");
    successDiv.textContent = "✓ Selection captured successfully!";
    successDiv.style.cssText = "color: green; font-size: 12px; margin: 5px 0;";
    codeArea.parentNode.insertBefore(successDiv, codeArea);
    setTimeout(() => successDiv.remove(), 3000);
    
  } else if (msg.action === "selection-cancelled") {
    codeArea.value = "Selection cancelled.";
    copyBtn.disabled = true;
    downloadBtn.disabled = true;
  } else if (msg.action === "selection-error") {
    codeArea.value = "Error during selection: " + (msg.error || "unknown");
    copyBtn.disabled = true;
    downloadBtn.disabled = true;
  }
});

copyBtn.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(codeArea.value);
    copyBtn.textContent = "Copied!";
    setTimeout(() => (copyBtn.textContent = "Copy HTML"), 1000);
  } catch (e) {
    alert("Copy failed: " + e);
  }
});

downloadBtn.addEventListener("click", () => {
  const blob = new Blob([codeArea.value], { type: "text/html" });
  const url = URL.createObjectURL(blob);
  chrome.downloads.download({ url, filename: "selected-section.html" }, () => {
    URL.revokeObjectURL(url);
  });
});
