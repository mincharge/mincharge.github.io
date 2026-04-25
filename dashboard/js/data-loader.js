/**
 * Data Loader Module
 *
 * Loads and parses transaction data from JSONL and metadata files.
 *
 * IMPORTANT: All timestamps in the data are stored without timezone indicators
 * and should be treated as local time (IST in production). We avoid any UTC
 * conversions to ensure date boundaries match user expectations.
 */

/**
 * Parse ISO timestamp string as local time
 * Avoids timezone conversion issues by treating the timestamp as local time
 * @param {string} isoString - ISO timestamp without timezone (e.g., "2026-01-23T14:12:33")
 * @returns {Date} Date object in local timezone
 */
function parseLocalTimestamp(isoString) {
    // Split the ISO string and parse as local time
    // Format: YYYY-MM-DDTHH:MM:SS
    const [datePart, timePart] = isoString.split('T');
    const [year, month, day] = datePart.split('-').map(Number);
    const [hours, minutes, seconds] = timePart.split(':').map(Number);

    // Create Date in local timezone (month is 0-indexed)
    return new Date(year, month - 1, day, hours, minutes, seconds);
}

/**
 * Load transactions from JSONL file
 * @returns {Promise<Array>} Array of transaction objects with Date objects
 */
export async function loadTransactions() {
    try {
        const response = await fetch('data/transactions.jsonl');

        if (!response.ok) {
            throw new Error(`Failed to load transactions: ${response.statusText}`);
        }

        const text = await response.text();
        const lines = text.trim().split('\n');

        // Parse each line as JSON and convert timestamps to Date objects
        const transactions = lines
            .map((line, index) => {
                try {
                    const txn = JSON.parse(line);

                    // Convert ISO timestamp strings to Date objects in LOCAL timezone
                    // This ensures consistency with filter logic and chart aggregation
                    txn.startDate = parseLocalTimestamp(txn.start);
                    txn.endDate = parseLocalTimestamp(txn.end);

                    return txn;
                } catch (error) {
                    console.error(`Error parsing line ${index + 1}:`, error);
                    return null;
                }
            })
            .filter(txn => txn !== null);

        console.log(`Loaded ${transactions.length} transactions`);
        return transactions;
    } catch (error) {
        console.error('Error loading transactions:', error);
        throw error;
    }
}

/**
 * Load metadata from JSON file
 * @returns {Promise<Object>} Metadata object
 */
export async function loadMetadata() {
    try {
        const response = await fetch('data/metadata.json');

        if (!response.ok) {
            throw new Error(`Failed to load metadata: ${response.statusText}`);
        }

        const metadata = await response.json();
        console.log('Loaded metadata:', metadata);

        return metadata;
    } catch (error) {
        console.error('Error loading metadata:', error);
        throw error;
    }
}

/**
 * Initialize data - load both transactions and metadata
 * @returns {Promise<Object>} Object with transactions and metadata
 */
export async function initializeData() {
    try {
        const [transactions, metadata] = await Promise.all([loadTransactions(), loadMetadata()]);

        return { transactions, metadata };
    } catch (error) {
        console.error('Error initializing data:', error);
        throw error;
    }
}
