// content_script.js
// New behavior: click-and-drag rectangle selection to choose a page section.
// After mouseup, we find a candidate element near the rectangle center,
// choose a meaningful ancestor if available, clone it, collect computed CSS
// from original nodes, inject data-uid attributes on the clone, and send the HTML.

function generateUID() {
  return "uid-" + Math.random().toString(36).slice(2, 9);
}

// Properties we capture to preserve visual appearance (keeps output smaller)
const CAPTURE_PROPS = [
  "display","position","top","left","right","bottom",
  "width","height","min-width","min-height","max-width","max-height",
  "margin","margin-top","margin-bottom","margin-left","margin-right",
  "padding","padding-top","padding-bottom","padding-left","padding-right",
  "color","background","background-color","background-image","background-size","background-position","background-repeat",
  "font","font-family","font-size","font-weight","line-height","letter-spacing",
  "border","border-width","border-style","border-color","border-radius",
  "box-shadow","text-shadow","text-align","vertical-align","overflow","white-space"
];

function shouldCaptureProp(prop) {
  return CAPTURE_PROPS.includes(prop);
}

function computedCSSForElement(el) {
  try {
    const cs = window.getComputedStyle(el);
    const rules = [];
    for (let i = 0; i < cs.length; i++) {
      const prop = cs[i];
      if (!shouldCaptureProp(prop)) continue;
      const val = cs.getPropertyValue(prop);
      if (!val) continue;
      const norm = val.trim();
      if (norm === "" || norm === "initial" || norm === "none" || norm === "normal" || norm === "0px") continue;
      rules.push(`${prop}: ${norm};`);
    }
    return rules.join(" ");
  } catch (e) {
    return "";
  }
}

// Clone root and map computed CSS from original -> clone using parallel traversal
function cloneAndCollect(root) {
  const originalNodes = [root, ...root.querySelectorAll("*")];
  const cloneRoot = root.cloneNode(true);
  const cloneNodes = [cloneRoot, ...cloneRoot.querySelectorAll("*")];

  // If structure mismatch (rare), fallback to cloning outerHTML only
  if (originalNodes.length !== cloneNodes.length) {
    // still try: assign uid only for cloneRoot
    const uid = generateUID();
    cloneRoot.setAttribute("data-source-copy-uid", uid);
    return { map: [{ uid, css: computedCSSForElement(root) }], html: cloneRoot.outerHTML };
  }

  const map = [];
  for (let i = 0; i < originalNodes.length; i++) {
    const orig = originalNodes[i];
    const cl = cloneNodes[i];
    const uid = generateUID();
    cl.setAttribute("data-source-copy-uid", uid);
    const css = computedCSSForElement(orig);
    if (css && css.trim().length > 0) {
      map.push({ uid, css });
    }
  }

  return { map, html: cloneRoot.outerHTML };
}

function buildStandaloneHTML(htmlString, map, title) {
  let style = "";
  map.forEach((item) => {
    style += `[data-source-copy-uid="${item.uid}"] { ${item.css} }\n`;
  });
  const tailwind = '<script src="https://cdn.tailwindcss.com"></script>';
  const doc = `<!doctype html>
<html>
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>${title || "Selected section"}</title>
${tailwind}
<style>
/* Scoped computed CSS */
${style}
</style>
</head>
<body>
${htmlString}
</body>
</html>`;
  return doc;
}

// Selection monitoring and automatic detection
function startSelectionMode() {
  if (window.__sourceCopySelectionActive) return;
  window.__sourceCopySelectionActive = true;

  // Instruction overlay (top-left small)
  const info = document.createElement("div");
  info.textContent = "Select any text or element on the page. Extension is monitoring your selections.";
  Object.assign(info.style, {
    position: "fixed", left: "12px", top: "12px", zIndex: 2147483647,
    background: "rgba(0,0,0,0.7)", color: "white", padding: "6px 10px", borderRadius: "6px",
    fontSize: "12px", fontFamily: "sans-serif", pointerEvents: "none"
  });
  document.documentElement.appendChild(info);

  // Auto-hide info after 3 seconds
  setTimeout(() => {
    if (info && info.parentNode) {
      info.parentNode.removeChild(info);
    }
  }, 3000);

  function handleSelectionChange() {
    // Add a small delay to avoid processing rapid selection changes
    if (window.__processingSelection) return;
    
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0 || selection.toString().trim().length === 0) {
      return; // No selection or empty selection
    }

    // Get the range and find the common ancestor
    const range = selection.getRangeAt(0);
    const commonAncestor = range.commonAncestorContainer;
    
    // Find the element that contains the selection
    let targetElement = commonAncestor.nodeType === Node.TEXT_NODE 
      ? commonAncestor.parentElement 
      : commonAncestor;

    // If the target is the document or body, find a better ancestor
    if (targetElement === document || targetElement === document.body || targetElement === document.documentElement) {
      // Try to find the first element within the selection
      const startContainer = range.startContainer;
      
      targetElement = startContainer.nodeType === Node.TEXT_NODE 
        ? startContainer.parentElement 
        : startContainer;
        
      // Find a meaningful ancestor that contains the selection
      let current = targetElement;
      while (current && current !== document.body && current !== document.documentElement) {
        try {
          if (range.intersectsNode && range.intersectsNode(current)) {
            targetElement = current;
            break;
          }
        } catch (e) {
          // Some nodes may not support intersectsNode
        }
        current = current.parentElement;
      }
    }

    // Debounce selection processing to avoid too many rapid calls
    clearTimeout(window.__selectionTimeout);
    window.__selectionTimeout = setTimeout(() => {
      if (window.__sourceCopySelectionActive) {
        processSelectedElement(targetElement, selection);
      }
    }, 800); // Increased delay to 800ms for better stability
  }

  function processSelectedElement(element, selection) {
    if (!element || !window.__sourceCopySelectionActive || window.__processingSelection) return;

    window.__processingSelection = true;

    try {
      // Show processing indicator
      const processingInfo = document.createElement("div");
      processingInfo.textContent = "Processing selection...";
      Object.assign(processingInfo.style, {
        position: "fixed", right: "12px", top: "12px", zIndex: 2147483647,
        background: "rgba(0,150,0,0.8)", color: "white", padding: "6px 10px", borderRadius: "6px",
        fontSize: "12px", fontFamily: "sans-serif", pointerEvents: "none"
      });
      document.documentElement.appendChild(processingInfo);

      // Clone element and collect CSS
      const { map, html } = cloneAndCollect(element);
      const selectedText = selection.toString().substring(0, 50);
      const standalone = buildStandaloneHTML(html, map, `Selected: ${selectedText}`);
      
      // Send back to popup (with error handling)
      try {
        chrome.runtime.sendMessage({ action: "selection-done", html: standalone });
      } catch (messageError) {
        console.log("Could not send message to popup (popup may be closed):", messageError);
      }

      // Remove processing indicator
      setTimeout(() => {
        if (processingInfo && processingInfo.parentNode) {
          processingInfo.parentNode.removeChild(processingInfo);
        }
        window.__processingSelection = false;
      }, 1500);

    } catch (err) {
      window.__processingSelection = false;
      try {
        chrome.runtime.sendMessage({ action: "selection-error", error: String(err) });
      } catch (messageError) {
        console.log("Could not send error message to popup:", messageError);
      }
    }
  }

  function onKeyDown(e) {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      cleanupAndCancel();
    }
  }

  function cleanupAndCancel() {
    removeListeners();
    clearTimeout(window.__selectionTimeout);
    if (info && info.parentNode) info.parentNode.removeChild(info);
    window.__sourceCopySelectionActive = false;
    chrome.runtime.sendMessage({ action: "selection-cancelled" });
  }

  function removeListeners() {
    document.removeEventListener("selectionchange", window.__handleSelectionChange);
    document.removeEventListener("keydown", window.__handleKeyDown, true);
  }

  // Store references for removal
  window.__handleSelectionChange = handleSelectionChange;
  window.__handleKeyDown = onKeyDown;

  // Listen for selection changes instead of mouse events
  document.addEventListener("selectionchange", window.__handleSelectionChange);
  document.addEventListener("keydown", window.__handleKeyDown, true);
}

// Listen for popup commands
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg && msg.action === "ping") {
    // Respond to ping to confirm content script is loaded
    sendResponse({ status: "ok" });
    return true;
  } else if (msg && msg.action === "start-selection") {
    try {
      startSelectionMode();
      sendResponse({ status: "ok" });
    } catch (e) {
      sendResponse({ status: "error", error: String(e) });
    }
    return true;
  } else if (msg && msg.action === "stop-selection") {
    try {
      if (window.__sourceCopySelectionActive) {
        // Find and remove any info overlays
        const infoElements = document.querySelectorAll('[style*="position: fixed"][style*="z-index: 2147483647"]');
        infoElements.forEach(el => {
          if (el.parentNode) el.parentNode.removeChild(el);
        });
        
        // Clear timeouts and reset state
        clearTimeout(window.__selectionTimeout);
        if (window.__handleSelectionChange) {
          document.removeEventListener("selectionchange", window.__handleSelectionChange);
        }
        if (window.__handleKeyDown) {
          document.removeEventListener("keydown", window.__handleKeyDown, true);
        }
        window.__sourceCopySelectionActive = false;
      }
      sendResponse({ status: "ok" });
    } catch (e) {
      sendResponse({ status: "error", error: String(e) });
    }
    return true;
  }
});
