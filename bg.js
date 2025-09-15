(() => {
    let requests = [];
    let blockedHosts = [];
    let videoUrls = [];
    let fileExts = [];
    let vidExts = [];
    let isXDMUp = true;
    let monitoring = true;
    let debug = false;
    let xdmHost = "http://127.0.0.1:9614";
    let disabled = false;
    let lastIcon;
    let lastPopup;
    let videoList = [];
    let mimeList = [];

    const log = (msg) => { if (debug) console.log(msg); };

    // --- send to XDM ---
    const sendToXDM = async (request, response, file, video) => {
        log("sending to xdm: " + response.url);
        let data = `url=${response.url}\r\n`;
        if (file) data += `file=${file}\r\n`;
        request?.requestHeaders?.forEach(h => data += `req=${h.name}:${h.value}\r\n`);
        response?.responseHeaders?.forEach(h => data += `res=${h.name}:${h.value}\r\n`);
        data += `res=tabId:${request.tabId}\r\nres=realUA:${navigator.userAgent}\r\n`;

        const cookies = await chrome.cookies.getAll({ url: response.url });
        cookies.forEach(c => data += `cookie=${c.name}:${c.value}\r\n`);

        fetch(xdmHost + (video ? "/video" : "/download"), { method: 'POST', body: data });
    };

    const sendUrlToXDM = async (url) => {
        log("sending to xdm: " + url);
        let data = `url=${url}\r\nres=realUA:${navigator.userAgent}\r\n`;
        const cookies = await chrome.cookies.getAll({ url });
        cookies.forEach(c => data += `cookie=${c.name}:${c.value}\r\n`);
        fetch(xdmHost + "/download", { method: 'POST', body: data });
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

        for (const header of response.responseHeaders) {
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
                    sendToXDM(request, response, tab.title, true);
                });
            } else {
                sendToXDM(request, response, null, true);
            }
        }
    };

    const syncXDM = async () => {
        try {
            const res = await fetch(xdmHost + "/sync");
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
        }
    };

    // --- initialization ---
    const initSelf = () => {
        // Listen for downloads
        chrome.downloads.onCreated.addListener((downloadItem) => {
            if (!monitoring || disabled) return;
            if (downloadItem.url) {
                sendUrlToXDM(downloadItem.url);
            }
        });

        // Monitor headers (optional video detection)
        chrome.webRequest.onHeadersReceived.addListener(
            (response) => {
                if (!isXDMUp || !monitoring || disabled) return;
                if (!(response.statusCode === 200 || response.statusCode === 206)) return;

                const req = requests.find(r => r.requestId === response.requestId);
                if (req && !(response.url + "").startsWith(xdmHost)) {
                    checkForVideo(req, response);
                }
                requests = requests.filter(r => r.requestId !== response.requestId);
            },
            { urls: ["<all_urls>"] },
            ["responseHeaders"]
        );

        chrome.webRequest.onSendHeaders.addListener(
            (info) => requests.push(info),
            { urls: ["<all_urls>"] },
            ["requestHeaders"]
        );

        chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
            if (request.type === "links") sendUrlsToXDM(request.links);
            else if (request.type === "stat") sendResponse({ isDisabled: disabled, list: videoList });
            else if (request.type === "cmd") disabled = request.disable;
            else if (request.type === "vid") fetch(xdmHost + "/item", { method: "POST", body: request.itemId });
            else if (request.type === "clear") fetch(xdmHost + "/clear");
        });

        chrome.commands.onCommand.addListener(() => { if (isXDMUp && monitoring) disabled = !disabled; });

        // Context menus (MV3 compliant)
        chrome.contextMenus.create({ id: "download-link", title: "Download with XDM", contexts: ["link", "video", "audio"] });
        chrome.contextMenus.create({ id: "download-image", title: "Download Image with XDM", contexts: ["image"] });
        chrome.contextMenus.create({ id: "download-all", title: "Download all links", contexts: ["all"] });

        chrome.contextMenus.onClicked.addListener((info, tab) => {
            switch(info.menuItemId){
                case "download-link": sendLinkToXDM(info); break;
                case "download-image": sendImageToXDM(info); break;
                case "download-all": runContentScript(info, tab); break;
            }
        });

        // Sync XDM using alarms
        chrome.alarms.create('syncXDM', { periodInMinutes: 0.0833 });
        chrome.alarms.onAlarm.addListener((alarm) => { if (alarm.name === 'syncXDM') syncXDM(); });
    };

    initSelf();
    log("loaded");
})();
