(() => {
    const SYNC_ALARM_NAME = "syncXDM";
    const SYNC_PERIOD_MINUTES = 1;

    const DEFAULT_XDM_HOST = "http://127.0.0.1:9614";
    const STORAGE_KEYS = {
        disabled: "disabled",
        debug: "debug",
        xdmHost: "xdmHost",
    };

    const requestById = new Map();

    let blockedHosts = [];
    let videoUrls = [];
    let fileExts = [];
    let vidExts = [];
    let isXDMUp = true;
    let monitoring = true;
    let debug = false;
    let xdmHost = DEFAULT_XDM_HOST;
    let disabled = false;
    let lastIcon;
    let lastPopup;
    let videoList = [];
    let mimeList = [];

    const log = (msg) => { if (debug) console.log(msg); };

    const safeFetch = async (url, options) => {
        try {
            return await fetch(url, options);
        } catch (e) {
            log(`fetch failed: ${url} (${e?.message || e})`);
            return null;
        }
    };

    const setActionPopup = (popup) => {
        if (lastPopup === popup) return;
        chrome.action.setPopup({ popup }, () => {
            if (chrome.runtime.lastError) return;
            lastPopup = popup;
        });
    };

    const setActionIcon = (path) => {
        if (lastIcon === path) return;
        chrome.action.setIcon({ path }, () => {
            if (chrome.runtime.lastError) return;
            lastIcon = path;
        });
    };

    const refreshActionUI = () => {
        if (!isXDMUp) {
            setActionPopup("fatal.html");
            setActionIcon("icon_blocked.png");
            return;
        }

        if (!monitoring) {
            setActionPopup("disabled.html");
            setActionIcon("icon_disabled.png");
            return;
        }

        setActionPopup("status.html");
        setActionIcon(disabled ? "icon_disabled.png" : "icon.png");
    };

    const loadState = async () => {
        const data = await chrome.storage.local.get([STORAGE_KEYS.disabled, STORAGE_KEYS.debug, STORAGE_KEYS.xdmHost]);
        disabled = Boolean(data?.[STORAGE_KEYS.disabled]);
        debug = Boolean(data?.[STORAGE_KEYS.debug]);
        xdmHost = (data?.[STORAGE_KEYS.xdmHost] || DEFAULT_XDM_HOST) + "";
    };

    const persistDisabled = async () => {
        await chrome.storage.local.set({ [STORAGE_KEYS.disabled]: disabled });
    };

    // --- send to XDM ---
    const sendToXDM = async (request, response, file, video) => {
        log("sending to xdm: " + response.url);
        let data = `url=${response.url}\r\n`;
        if (file) data += `file=${file}\r\n`;
        request?.requestHeaders?.forEach(h => data += `req=${h.name}:${h.value}\r\n`);
        response?.responseHeaders?.forEach(h => data += `res=${h.name}:${h.value}\r\n`);
        data += `res=tabId:${request.tabId}\r\nres=realUA:${navigator.userAgent}\r\n`;

        try {
            const cookies = await chrome.cookies.getAll({ url: response.url });
            cookies.forEach(c => data += `cookie=${c.name}:${c.value}\r\n`);
        } catch (e) {
            log(`cookie read failed: ${e?.message || e}`);
        }

        await safeFetch(xdmHost + (video ? "/video" : "/download"), { method: 'POST', body: data });
    };

    const sendUrlToXDM = async (url) => {
        log("sending to xdm: " + url);
        let data = `url=${url}\r\nres=realUA:${navigator.userAgent}\r\n`;
        try {
            const cookies = await chrome.cookies.getAll({ url });
            cookies.forEach(c => data += `cookie=${c.name}:${c.value}\r\n`);
        } catch (e) {
            log(`cookie read failed: ${e?.message || e}`);
        }
        await safeFetch(xdmHost + "/download", { method: 'POST', body: data });
    };

    const sendUrlsToXDM = async (urls) => {
        if (!Array.isArray(urls) || urls.length === 0) return;
        const unique = new Set();
        for (const url of urls) {
            if (!url) continue;
            const u = (url + "").trim();
            if (!u) continue;
            unique.add(u);
            if (unique.size >= 500) break;
        }

        for (const url of unique) {
            await sendUrlToXDM(url);
        }
    };

    const sendImageToXDM = (info) => {
        let url = info.srcUrl || info.linkUrl || info.pageUrl;
        if (url) sendUrlToXDM(url);
    };

    const sendLinkToXDM = (info) => {
        let url = info.linkUrl || info.srcUrl || info.pageUrl;
        if (url) sendUrlToXDM(url);
    };

    const runContentScript = (info, tab) => {
        log("running content script");
        chrome.scripting.executeScript({
            target: { tabId: tab.id },
            files: ['contentscript.js']
        });
    };

    // --- handle video detection ---
    const checkForVideo = (request, response) => {
        let mime = "";
        let video = false;
        const url = response.url;

        for (const header of response.responseHeaders || []) {
            if (header.name.toLowerCase() === "content-type") {
                mime = header.value.toLowerCase();
                break;
            }
        }

        if (mime.startsWith("audio/") || mime.startsWith("video/")) {
            video = true;
        }

        if (video) {
            if (request.tabId !== -1) {
                chrome.tabs.get(request.tabId, (tab) => {
                    const title = chrome.runtime.lastError ? null : tab?.title;
                    void sendToXDM(request, response, title, true);
                });
            } else {
                void sendToXDM(request, response, null, true);
            }
        }
    };

    const syncXDM = async () => {
        try {
            const res = await safeFetch(xdmHost + "/sync");
            if (!res) throw new Error("XDM sync failed");
            if (!res.ok) throw new Error("XDM sync failed");
            const data = await res.json();
            monitoring = data.enabled;
            blockedHosts = data.blockedHosts;
            videoUrls = data.videoUrls;
            fileExts = data.fileExts;
            vidExts = data.vidExts;
            isXDMUp = true;
            videoList = data.vidList;
            mimeList = data.mimeList || [];
        } catch (e) {
            isXDMUp = false;
            monitoring = false;
            videoList = [];
        }

        refreshActionUI();
    };

    const ensureSyncAlarm = () => {
        chrome.alarms.create(SYNC_ALARM_NAME, { periodInMinutes: SYNC_PERIOD_MINUTES });
    };

    const createContextMenus = () => {
        chrome.contextMenus.removeAll(() => {
            if (chrome.runtime.lastError) return;
            chrome.contextMenus.create({ id: "download-link", title: "Download with XDM", contexts: ["link", "video", "audio"] });
            chrome.contextMenus.create({ id: "download-image", title: "Download Image with XDM", contexts: ["image"] });
            chrome.contextMenus.create({ id: "download-all", title: "Download all links", contexts: ["all"] });
        });
    };

    // --- listeners ---

    chrome.runtime.onInstalled.addListener(() => {
        createContextMenus();
        ensureSyncAlarm();
        void syncXDM();
    });

    chrome.runtime.onStartup?.addListener?.(() => {
        ensureSyncAlarm();
        void syncXDM();
    });

    chrome.downloads.onCreated.addListener((downloadItem) => {
        if (!monitoring || disabled) return;
        if (downloadItem.url) void sendUrlToXDM(downloadItem.url);
    });

    chrome.webRequest.onHeadersReceived.addListener(
        (response) => {
            if (!isXDMUp || !monitoring || disabled) return;
            if (!(response.statusCode === 200 || response.statusCode === 206)) return;

            const req = requestById.get(response.requestId);
            requestById.delete(response.requestId);

            if (req && !(response.url + "").startsWith(xdmHost)) {
                checkForVideo(req, response);
            }
        },
        { urls: ["<all_urls>"] },
        ["responseHeaders"]
    );

    chrome.webRequest.onSendHeaders.addListener(
        (info) => {
            if (!isXDMUp || !monitoring || disabled) return;
            requestById.set(info.requestId, info);
        },
        { urls: ["<all_urls>"] },
        ["requestHeaders"]
    );

    chrome.webRequest.onCompleted.addListener(
        (info) => requestById.delete(info.requestId),
        { urls: ["<all_urls>"] }
    );

    chrome.webRequest.onErrorOccurred.addListener(
        (info) => requestById.delete(info.requestId),
        { urls: ["<all_urls>"] }
    );

    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
        (async () => {
            if (request?.type === "links") {
                if (!monitoring || disabled) return;
                await sendUrlsToXDM(request.links);
                return;
            }

            if (request?.type === "stat") {
                await syncXDM();
                sendResponse({ isDisabled: disabled, list: videoList || [] });
                return;
            }

            if (request?.type === "cmd") {
                disabled = Boolean(request.disable);
                await persistDisabled();
                refreshActionUI();
                return;
            }

            if (request?.type === "vid") {
                await safeFetch(xdmHost + "/item", { method: "POST", body: request.itemId });
                return;
            }

            if (request?.type === "clear") {
                await safeFetch(xdmHost + "/clear");
                return;
            }
        })().catch((e) => log(e?.message || e));

        return request?.type === "stat";
    });

    chrome.commands.onCommand.addListener((command) => {
        if (command !== "toggle-monitoring") return;
        if (!isXDMUp || !monitoring) return;
        disabled = !disabled;
        void persistDisabled();
        refreshActionUI();
    });

    chrome.contextMenus.onClicked.addListener((info, tab) => {
        if (!isXDMUp || !monitoring || disabled) return;
        switch (info.menuItemId) {
            case "download-link": sendLinkToXDM(info); break;
            case "download-image": sendImageToXDM(info); break;
            case "download-all": runContentScript(info, tab); break;
        }
    });

    chrome.alarms.onAlarm.addListener((alarm) => {
        if (alarm.name !== SYNC_ALARM_NAME) return;
        void syncXDM();
    });

    // --- initialization ---
    void (async () => {
        await loadState();
        ensureSyncAlarm();
        await syncXDM();
        log("loaded");
    })();
})();
