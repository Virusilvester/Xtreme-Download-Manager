const links = Array.from(document.links || [])
  .map((a) => a?.href)
  .filter(Boolean);

chrome.runtime.sendMessage({ type: "links", links });
