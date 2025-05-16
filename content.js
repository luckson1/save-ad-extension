// content.js

const PROCESSED_MARKER_CLASS = 'ad-saver-extension-processed-card';
const SAVE_BUTTON_CLASS = 'ad-saver-extension-save-button';
const SAVED_BUTTON_CLASS = 'ad-saver-extension-saved-button'; // New class for saved state
const BUTTON_WRAPPER_CLASS = 'ad-saver-button-wrapper'; // For the new wrapper
const ADVERT_FARM_LOGIN_URL = 'https://www.advertfarm.com/'; // Or your specific login page
const ADVERT_FARM_INSPIRATION_URL = 'https://www.advertfarm.com/inspiration'; // URL for inspiration page
// const ADVERT_FARM_API_TEST_URL = 'https://www.advertfarm.com/api/test'; // No longer called directly from here
// const LOCAL_STORAGE_ORG_KEY = "selectedOrgId"; // Handled by background script

/**
 * Checks with background script if an ad is already saved
 * @param {string} libraryId - The library ID to check
 * @returns {Promise<boolean>} - True if already saved
 */
function checkIfAdSaved(libraryId) {
    return new Promise((resolve) => {
        chrome.runtime.sendMessage(
            { 
                action: "checkAdSaved", 
                data: { libraryId }
            }, 
            (response) => {
                if (chrome.runtime.lastError) {
                    console.error('Error checking saved status:', chrome.runtime.lastError);
                    resolve(false);
                } else {
                    resolve(response && response.isSaved);
                }
            }
        );
    });
}

// Debouncer function to limit how often a function is called
function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

/**
 * Extracts the Library ID from a given ad card element.
 * @param {HTMLElement} adCardElement - The DOM element suspected to be an ad card.
 * @returns {string|null} The extracted library ID, or null if not found.
 */
function extractLibraryId(adCardElement) {
    // XPath to find any element within adCardElement that starts with "Library ID:"
    // The leading '.' makes the XPath relative to adCardElement
    const xpathResult = document.evaluate(
        ".//*[starts-with(normalize-space(.), 'Library ID:')]",
        adCardElement,
        null,
        XPathResult.FIRST_ORDERED_NODE_TYPE,
        null
    );
    const idElement = xpathResult.singleNodeValue;

    if (idElement && idElement.textContent) {
        const match = idElement.textContent.match(/Library ID:\s*(\d+)/);
        if (match && match[1]) {
            return match[1];
        }
    }
    // console.warn('[Ad Saver] Library ID text not found or malformed in:', adCardElement);
    return null;
}

/**
 * Creates and injects a "Save Ad to Advert Farm" button below the original Meta button.
 * @param {HTMLElement} originalButtonElement - The original Meta button element (div[role="button"]).
 * @param {string} libraryId - The library ID for this ad.
 */
async function addSaveButtonToAd(originalButtonElement, libraryId) {
    // Check if our button wrapper already exists (avoids duplicates)
    if (originalButtonElement.parentElement.querySelector('.' + BUTTON_WRAPPER_CLASS)) {
        return;
    }

    // Check if this ad is already saved
    const isSaved = await checkIfAdSaved(libraryId);

    // Get the parent container of the original button
    const parentContainer = originalButtonElement.parentElement;
    if (!parentContainer) return;

    // Create a wrapper div that will contain both buttons in a column layout
    const flexColumnWrapper = document.createElement('div');
    flexColumnWrapper.className = BUTTON_WRAPPER_CLASS;
    flexColumnWrapper.style.display = 'flex';
    flexColumnWrapper.style.flexDirection = 'column';
    flexColumnWrapper.style.width = '100%';
    flexColumnWrapper.style.gap = '8px'; // Space between buttons

    // Determine if we're in dark mode
    const isDarkMode = document.documentElement.classList.contains('dark') || 
                      window.matchMedia('(prefers-color-scheme: dark)').matches;
    
    // Get the primary color based on theme
    // Using the HSL values from user's CSS variables
    const primaryColor = isDarkMode 
        ? 'hsl(263.4, 70%, 50.4%)' // dark mode primary
        : 'hsl(262.1, 83.3%, 57.8%)'; // light mode primary
    
    // Create our new save button
    const saveButton = document.createElement('div');
    saveButton.setAttribute('role', 'button');
    
    if (isSaved) {
        // Styling for already saved ads
        saveButton.className = SAVED_BUTTON_CLASS;
        saveButton.style.backgroundColor = isDarkMode ? 'hsl(150, 70%, 30%)' : 'hsl(150, 60%, 40%)'; // Green shade
        
        // Add a checkmark and "Saved to Advert Farm" text
        const textSpan = document.createElement('span');
        textSpan.textContent = '✓ Saved to Advert Farm';
        textSpan.style.fontWeight = 'bold';
        saveButton.appendChild(textSpan);

        // Make it slightly less prominent with lower opacity
        saveButton.style.opacity = '0.85';
    } else {
        // Normal styling for unsaved ads
        saveButton.className = SAVE_BUTTON_CLASS;
        saveButton.style.backgroundColor = primaryColor;
        
        // Create text content for save button
        const textSpan = document.createElement('span');
        textSpan.textContent = 'Save Ad to Advert Farm';
        textSpan.style.fontWeight = 'bold';
        saveButton.appendChild(textSpan);
        
        // Add click event listener - only for unsaved ads
        saveButton.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();

            // Disable button and show saving state
            saveButton.style.opacity = '0.7';
            textSpan.textContent = 'Saving...';
            saveButton.setAttribute('disabled', 'true');

            // Send data to background script to handle the save operation
            chrome.runtime.sendMessage(
                { 
                    action: "saveAdViaAdvertFarmTab", 
                    data: { libraryId: libraryId /* other ad details if any from the page */ } 
                }, 
                (response) => {
                    if (chrome.runtime.lastError) {
                        console.error('[Ad Saver] Error communicating with background script:', chrome.runtime.lastError.message);
                        textSpan.textContent = 'Error';
                        alert('An error occurred while trying to save. Check console.');
                        
                        // Re-enable button after a short delay
                        setTimeout(() => {
                            textSpan.textContent = 'Save Ad to Advert Farm';
                            saveButton.style.opacity = '1';
                            saveButton.removeAttribute('disabled');
                        }, 2000);
                    } else if (response && response.success) {
                        console.log('[Ad Saver] Ad save initiated successfully via background:', response.data);
                        
                        // Update button to saved state permanently
                        saveButton.className = SAVED_BUTTON_CLASS;
                        saveButton.style.backgroundColor = isDarkMode ? 'hsl(150, 70%, 30%)' : 'hsl(150, 60%, 40%)';
                        textSpan.textContent = '✓ Saved to Advert Farm';
                        saveButton.style.opacity = '0.85';
                        
                        // Remove click event listener
                        saveButton.replaceWith(saveButton.cloneNode(true));
                        
                        alert(response.message || 'Ad successfully saved to Advert Farm!');
                    } else {
                        console.error('[Ad Saver] Failed to save ad via background:', response);
                        textSpan.textContent = 'Save Failed';
                        let alertMessage = 'Failed to save ad.';
                        if (response && response.message) {
                            alertMessage += ` Reason: ${response.message}`;
                        }
                        if (response && response.redirectToLogin) {
                            alert('You need to be logged into Advert Farm. Redirecting...');
                            window.open(ADVERT_FARM_LOGIN_URL, '_blank');
                        } else if (response && response.redirectToInspiration) {
                            alert('Organization ID not found. Please select an organization on the Advert Farm inspiration page. Redirecting...');
                            window.open(ADVERT_FARM_INSPIRATION_URL, '_blank');
                        } else {
                            alert(alertMessage);
                        }
                        
                        // Re-enable button after a short delay
                        setTimeout(() => {
                            textSpan.textContent = 'Save Ad to Advert Farm';
                            saveButton.style.opacity = '1';
                            saveButton.removeAttribute('disabled');
                        }, 2000);
                    }
                }
            );
        });
    }
    
    // Common styling for both saved and unsaved states
    saveButton.style.color = 'white';
    saveButton.style.border = 'none';
    saveButton.style.borderRadius = 'var(--radius, 0.5rem)';
    saveButton.style.cursor = isSaved ? 'default' : 'pointer';
    saveButton.style.padding = originalButtonElement.style.padding || '0px';
    saveButton.style.width = '100%';
    saveButton.style.height = originalButtonElement.offsetHeight + 'px';
    saveButton.style.display = 'flex';
    saveButton.style.justifyContent = 'center';
    saveButton.style.alignItems = 'center';
    
    // Replace the original button with our wrapper
    parentContainer.insertBefore(flexColumnWrapper, originalButtonElement);
    
    // Move the original button into our wrapper as the first child
    flexColumnWrapper.appendChild(originalButtonElement);
    
    // Add our save button as the second child
    flexColumnWrapper.appendChild(saveButton);
}

/**
 * Finds all ad cards on the page, extracts their IDs, and adds "Save Ad" buttons.
 */
function findAndProcessAds() {
    // console.log('[Ad Saver] Scanning for ads...');

    // Find all <div> elements containing the text "See ad details" OR "See summary details".
    const detailButtonTextElements = document.evaluate(
        "//div[normalize-space(text())='See ad details' or normalize-space(text())='See summary details']",
        document,
        null,
        XPathResult.UNORDERED_NODE_SNAPSHOT_TYPE,
        null
    );

    // console.log(`[Ad Saver] Found ${detailButtonTextElements.snapshotLength} potential detail button texts.`);

    for (let i = 0; i < detailButtonTextElements.snapshotLength; i++) {
        const textElement = detailButtonTextElements.snapshotItem(i);

        // The actual clickable button is an ancestor div with role="button"
        const clickableButtonElement = textElement.closest('div[role="button"]');

        if (!clickableButtonElement) {
            // console.warn('[Ad Saver] Could not find parent div[role="button"] for text:', textElement.textContent.trim(), textElement);
            continue;
        }

        // Determine the "ad card" element, which is an ancestor of the clickableButtonElement
        // and should contain the "Library ID:" text.
        let adCardElement = null;
        let currentAncestor = clickableButtonElement.parentElement;
        // Increase search depth if necessary, 10 levels should typically be enough.
        for (let j = 0; j < 10; j++) {
            if (!currentAncestor) break;
            // Check if this ancestor contains the Library ID text
            if (extractLibraryId(currentAncestor)) {
                 adCardElement = currentAncestor;
                 break;
            }
            currentAncestor = currentAncestor.parentElement;
        }

        if (!adCardElement) {
            // console.warn('[Ad Saver] Could not identify a suitable ad card container for button:', clickableButtonElement);
            continue;
        }

        // Check if this ad card has already been processed by our extension
        if (adCardElement.classList.contains(PROCESSED_MARKER_CLASS)) {
            // console.log('[Ad Saver] Ad card already processed, skipping button addition for ID (if any):', adCardElement);
            continue;
        }

        const libraryId = extractLibraryId(adCardElement); // Re-extract from the confirmed adCardElement

        if (libraryId) {
            // console.log('[Ad Saver] Adding button for Library ID:', libraryId, 'to card:', adCardElement);
            addSaveButtonToAd(clickableButtonElement, libraryId); // Pass the Meta button, not the ad card
            adCardElement.classList.add(PROCESSED_MARKER_CLASS); // Mark this ad card as processed
        } else {
            // console.warn('[Ad Saver] Could not find Library ID in identified ad card:', adCardElement, 'associated with button:', clickableButtonElement);
        }
    }
}

// --- MutationObserver to handle dynamically loaded ads (e.g., infinite scroll) ---
const debouncedProcessAds = debounce(findAndProcessAds, 500); // Debounce to avoid too many calls

const observer = new MutationObserver((mutationsList) => {
    for (const mutation of mutationsList) {
        // We are interested in changes where new nodes are added to the DOM.
        if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
            // A simple check: if added nodes contain typical ad text, or just re-scan.
            // For robustness, just re-scan on additions.
            debouncedProcessAds();
            return; // No need to check other mutations in this batch if one triggered a scan
        }
    }
});

/**
 * Initial setup run when the content script loads.
 */
function initialSetup() {
  

    // Initial scans for ads already on the page.
    // Facebook Ad Library content can load progressively.
    setTimeout(findAndProcessAds, 1000); // Run after 1s
    setTimeout(findAndProcessAds, 3000); // Run again after 3s for slower elements
    setTimeout(findAndProcessAds, 5000); // And one more pass

    // Start observing the document body for future DOM changes.
    // `subtree: true` is important to catch changes deep in the DOM.
    const targetNode = document.body;
    const observerConfig = { childList: true, subtree: true };
    observer.observe(targetNode, observerConfig);
}

// Ensure the setup runs only once, even if the script is injected multiple times (e.g. during development)
if (!document.getElementById('meta-ad-saver-extension-initialized-marker')) {
    const marker = document.createElement('div');
    marker.id = 'meta-ad-saver-extension-initialized-marker';
    marker.style.display = 'none'; // Keep it hidden
    document.body.appendChild(marker);

    initialSetup();
}