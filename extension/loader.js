// Classic script injected by background.js. Injected scripts can't be ES modules
// directly, so this loads the panel module and toggles it.
(async () => {
  const panel = await import(chrome.runtime.getURL("panel/panel.js"));
  panel.togglePanel();
})();
