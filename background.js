// background.js

const ADVERT_FARM_SESSION_URL = 'https://www.swipefile.pro/api/auth/session';
const ADVERT_FARM_LOGIN_URL = 'https://www.swipefile.pro/'; // Or your specific login page
const ADVERT_FARM_INSPIRATION_URL = 'https://www.swipefile.pro/saved'; // For redirection
const ADVERT_FARM_API_SAVE_AD_URL = 'https://www.swipefile.pro/api/save-library-data'; // Your actual save endpoint
const LOCAL_STORAGE_ORG_KEY = "selectedOrgId";
const SAVED_ADS_STORAGE_KEY = "savedAdLibraryIds"; // Key for storing saved ad IDs

/**
 * Adds a libraryId to the saved ads list in chrome.storage.local
 * @param {string} libraryId - The library ID of the saved ad
 * @returns {Promise<void>}
 */
async function markAdAsSaved(libraryId) {
    try {
        // Get current saved ads
        const result = await chrome.storage.local.get(SAVED_ADS_STORAGE_KEY);
        let savedAds = result[SAVED_ADS_STORAGE_KEY] || [];
        
        // Don't add duplicates
        if (!savedAds.includes(libraryId)) {
            savedAds.push(libraryId);
            await chrome.storage.local.set({ [SAVED_ADS_STORAGE_KEY]: savedAds });
            console.log(`[Ad Saver Background] Added libraryId ${libraryId} to saved ads list.`);
        }
    } catch (error) {
        console.error('[Ad Saver Background] Error saving ad to storage:', error);
    }
}

/**
 * Checks if an ad is already saved
 * @param {string} libraryId - The library ID to check
 * @returns {Promise<boolean>} - True if already saved
 */
async function isAdSaved(libraryId) {
    try {
        const result = await chrome.storage.local.get(SAVED_ADS_STORAGE_KEY);
        const savedAds = result[SAVED_ADS_STORAGE_KEY] || [];
        return savedAds.includes(libraryId);
    } catch (error) {
        console.error('[Ad Saver Background] Error checking if ad is saved:', error);
        return false;
    }
}

/**
 * Checks if the user has an active session on Swipe File.
 * @returns {Promise<object|null>} The session data object if active, or null if not or on error.
 */
async function checkSwipeFileSession() {
    try {
        const response = await fetch(ADVERT_FARM_SESSION_URL, {
            method: 'GET',
            headers: {
                'Accept': 'application/json'
            }
        });

        if (!response.ok) {
            console.warn(`[Ad Saver] Session check failed with status: ${response.status}`);
            return null; // Return null on failure
        }

        const sessionData = await response.json();
        // NextAuth returns an empty object {} if no session, or session object if active
        // We consider any object with properties (e.g., user, expires) as an active session.
        const isActive = sessionData && Object.keys(sessionData).length > 0 && sessionData.user;
        
        if (isActive) {
            console.log('[Ad Saver] Session active. Data:', sessionData);
            return sessionData; // Return the whole session data object
        } else {
            console.log('[Ad Saver] Session not active or no user data.');
            return null;
        }
    } catch (error) {
        console.error('[Ad Saver] Error checking Swipe File session:', error);
        return null; // Return null on error
    }
}

/**
 * Attempts to get an item from localStorage of an swipefile.pro tab.
 * @returns {Promise<string|null>} The organization ID or null if not found/error.
 */
async function getOrgIdFromSwipeFileTab() {
    try {
        const tabs = await chrome.tabs.query({ url: "https://www.swipefile.pro/*" });
        if (tabs && tabs.length > 0) {
            // Try to find an active tab first, or just take the first one
            const targetTab = tabs.find(t => t.active) || tabs[0];
            if (targetTab && targetTab.id) {
                const results = await chrome.scripting.executeScript({
                    target: { tabId: targetTab.id },
                    func: (key) => localStorage.getItem(key),
                    args: [LOCAL_STORAGE_ORG_KEY]
                });
                if (results && results.length > 0 && results[0].result) {
                    console.log('[Ad Saver] Retrieved Org ID from swipefile.pro tab:', results[0].result);
                    return results[0].result;
                }
                console.warn('[Ad Saver] Org ID not found in localStorage of swipefile.pro tab or script execution failed.');
            }
        } else {
            console.warn('[Ad Saver] No active swipefile.pro tab found to retrieve Org ID.');
        }
    } catch (error) {
        console.error('[Ad Saver] Error executing script on swipefile.pro tab:', error);
    }
    return null;
}

// Function to be injected into the swipefile.pro tab to make the API call
async function saveAdInPageContext(apiUrl, payload) {
    // This function runs in the context of the swipefile.pro page
    try {
        const response = await fetch(apiUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                // Cookies are automatically sent because this is a same-origin request
            },
            body: JSON.stringify(payload)
        });
        const responseData = await response.json(); // Try to parse JSON regardless of ok status for error messages
        if (!response.ok) {
            // Throw an error that includes the message from the backend if available
            throw new Error(responseData.message || `API Error: ${response.status} ${response.statusText}`);
        }
        return { success: true, data: responseData, message: responseData.message || "Ad saved successfully from page context." };
    } catch (error) {
        console.error('Error within saveAdInPageContext (injected script):', error);
        // Ensure the error object sent back is structured and serializable
        return { success: false, message: error.message || 'Failed to save ad in page context.' };
    }
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "checkAuth") {
        checkSwipeFileSession().then(sessionData => {
            sendResponse({ sessionData }); 
        });
        return true;
    }

    if (request.action === "checkAdSaved") {
        const { libraryId } = request.data;
        isAdSaved(libraryId).then(isSaved => {
            sendResponse({ isSaved });
        });
        return true;
    }

    if (request.action === "saveAdViaSwipeFileTab") {
        (async () => {
            const { libraryId, isTiktok } = request.data;

            const sessionData = await checkSwipeFileSession();
            if (!sessionData || !sessionData.user) {
                sendResponse({ success: false, message: "User not authenticated.", redirectToLogin: true });
                return;
            }
            const userId = sessionData.user.id;

            const organizationId = await getOrgIdFromSwipeFileTab();
            if (!organizationId) {
                sendResponse({ success: false, message: "Organization ID not found.", redirectToInspiration: true });
                return;
            }

            const SwipeFileTabs = await chrome.tabs.query({ url: "https://www.swipefile.pro/*" });
            if (!SwipeFileTabs || SwipeFileTabs.length === 0) {
                sendResponse({ success: false, message: "Swipe File tab not open. Please open Swipe File to save ads." });
                return;
            }
            // Prefer active tab, otherwise take the first one.
            const targetTab = SwipeFileTabs.find(t => t.active) || SwipeFileTabs[0];

            if (!targetTab || !targetTab.id) {
                 sendResponse({ success: false, message: "Could not find a suitable Swipe File tab." });
                 return;
            }

            try {
                const payload = { userId, organizationId };
                if (isTiktok) {
                    payload.creativeLink = libraryId; // For TikTok, libraryId is the link
                    payload.library = 'tiktok';
                } else {
                    payload.libraryId = libraryId; // For Facebook
                    payload.library = 'meta';
                }
                
                const executionResults = await chrome.scripting.executeScript({
                    target: { tabId: targetTab.id },
                    func: saveAdInPageContext, // The function to inject
                    args: [ADVERT_FARM_API_SAVE_AD_URL, payload] // Args to pass to the injected function
                });
                
                // executeScript returns an array of results, one for each frame injected.
                // We expect one result from the main frame.
                if (executionResults && executionResults.length > 0 && executionResults[0].result) {
                    const result = executionResults[0].result;
                    if (result.success) {
                        // If save was successful, mark the ad as saved in storage
                        // The `libraryId` from the request is the unique identifier we use for storage,
                        // which is the ad's ID for Facebook and the creative link for TikTok.
                        await markAdAsSaved(libraryId);
                    }
                    sendResponse(result);
                } else {
                    console.error("[Ad Saver Background] Script injection for saveAdInPageContext didn't return expected result.", executionResults);
                    sendResponse({ success: false, message: "Failed to execute save operation in Swipe File tab." });
                }
            } catch (error) {
                console.error('[Ad Saver Background] Error executing script in Swipe File tab:', error);
                sendResponse({ success: false, message: `Error saving ad: ${error.message}` });
            }
        })();
        return true; // Important for asynchronous sendResponse
    }
    return false; // For synchronous messages or if action not handled
});

// Optional: Listen for tab updates to potentially re-check auth if the user logs in/out
// on the Swipe File domain in another tab.
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (changeInfo.status === 'complete' && tab.url && tab.url.startsWith(ADVERT_FARM_LOGIN_URL)) {
        console.log('[Ad Saver] User interacted with Swipe File domain. Session status might have changed.');
        // Potentially trigger a re-check or notify content scripts, if needed for immediate UI updates.
        // For now, we rely on the check happening before an action.
    }
});

console.log('[Ad Saver] Background script loaded and updated.'); 