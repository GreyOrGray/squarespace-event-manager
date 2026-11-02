// Clicking the toolbar button injects the importer panel into the current tab.
// "activeTab" grants access only to the tab you clicked on, only at that moment.
chrome.action.onClicked.addListener(async (tab) => {
  if (tab.id === undefined) return;
  await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    files: ["loader.js"],
  });
});
