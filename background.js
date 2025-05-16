// background.js

const ADVERT_FARM_SESSION_URL = 'https://www.advertfarm.com/api/auth/session';
const ADVERT_FARM_LOGIN_URL = 'https://www.advertfarm.com/'; // Or your specific login page
const LOCAL_STORAGE_ORG_KEY = "selectedOrgId";

/**
 * Checks if the user has an active session on Advert Farm.
 * @returns {Promise<object|null>} The session data object if active, or null if not or on error.
 */
async function checkAdvertFarmSession() {
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
        console.error('[Ad Saver] Error checking Advert Farm session:', error);
        return null; // Return null on error
    }
}

/**
 * Attempts to get an item from localStorage of an advertfarm.com tab.
 * @returns {Promise<string|null>} The organization ID or null if not found/error.
 */
async function getOrgIdFromAdvertFarmTab() {
    try {
        const tabs = await chrome.tabs.query({ url: "https://www.advertfarm.com/*" });
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
                    console.log('[Ad Saver] Retrieved Org ID from advertfarm.com tab:', results[0].result);
                    return results[0].result;
                }
                console.warn('[Ad Saver] Org ID not found in localStorage of advertfarm.com tab or script execution failed.');
            }
        } else {
            console.warn('[Ad Saver] No active advertfarm.com tab found to retrieve Org ID.');
        }
    } catch (error) {
        console.error('[Ad Saver] Error executing script on advertfarm.com tab:', error);
    }
    return null;
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "checkAuth") {
        (async () => {
            const sessionData = await checkAdvertFarmSession();
            let organizationId = null;
            if (sessionData && sessionData.user) { // Only try to get orgId if authenticated
                organizationId = await getOrgIdFromAdvertFarmTab();
            }
            sendResponse({ sessionData, organizationId });
        })();
        return true; // Indicates that the response is sent asynchronously
    }
    // Future actions can be handled here
});

// Optional: Listen for tab updates to potentially re-check auth if the user logs in/out
// on the Advert Farm domain in another tab.
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (changeInfo.status === 'complete' && tab.url && tab.url.startsWith(ADVERT_FARM_LOGIN_URL)) {
        console.log('[Ad Saver] User interacted with Advert Farm domain. Session status might have changed.');
        // Potentially trigger a re-check or notify content scripts, if needed for immediate UI updates.
        // For now, we rely on the check happening before an action.
    }
});

console.log('[Ad Saver] Background script loaded.'); 