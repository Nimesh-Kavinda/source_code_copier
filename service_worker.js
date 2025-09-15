chrome.runtime.onInstalled.addListener(() => {
  console.log("Source Code Copy Tool installed.");
});

// Store the latest selection result so it persists even if popup closes
let latestSelection = null;

// Listen for messages from content scripts
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === "selection-done" && msg.html) {
    // Store the latest selection
    latestSelection = {
      html: msg.html,
      timestamp: Date.now(),
      tabId: sender.tab.id,
      url: sender.tab.url
    };
    
    // Forward to popup if it's open
    chrome.runtime.sendMessage(msg).catch(() => {
      // Popup is closed, that's fine - we stored the result
      console.log("Selection captured and stored (popup was closed)");
    });
    
    // Show notification badge
    chrome.action.setBadgeText({ 
      text: "1", 
      tabId: sender.tab.id 
    });
    chrome.action.setBadgeBackgroundColor({ color: "#4CAF50" });
    
  } else if (msg.action === "selection-error") {
    // Forward error to popup if open
    chrome.runtime.sendMessage(msg).catch(() => {
      console.log("Selection error occurred (popup was closed)");
    });
  }
});

// When popup opens, send the latest selection if available
chrome.runtime.onConnect.addListener((port) => {
  if (port.name === "popup") {
    if (latestSelection) {
      port.postMessage({
        action: "restore-selection",
        data: latestSelection
      });
    }
  }
});

// Clear badge when popup is opened
chrome.action.onClicked.addListener((tab) => {
  chrome.action.setBadgeText({ text: "", tabId: tab.id });
});
