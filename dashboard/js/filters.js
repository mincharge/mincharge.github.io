/**
 * Filters Module
 *
 * Handles filter logic for transactions including multi-select filters
 * and default time range (last 30 days).
 */

/**
 * Filter State Class
 */
export class FilterState {
    constructor(metadata) {
        this.vendors = [...metadata.vendors]; // All vendors selected by default
        this.stations = [...metadata.stations]; // All stations selected by default

        // Default: start = 1st of current month, end = tomorrow (00:00:00)
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const tomorrow = new Date(today);
        tomorrow.setDate(today.getDate() + 1);

        const firstOfMonth = new Date(today.getFullYear(), today.getMonth(), 1, 0, 0, 0);

        this.startTime = firstOfMonth;
        this.endTime = tomorrow;
    }

    /**
     * Get copy of current filter state
     */
    clone() {
        const state = Object.create(FilterState.prototype);
        state.vendors = [...this.vendors];
        state.stations = [...this.stations];
        state.startTime = new Date(this.startTime);
        state.endTime = new Date(this.endTime);
        return state;
    }
}

/**
 * Apply filters to transactions
 * @param {Array} transactions - Array of transaction objects
 * @param {FilterState} filterState - Current filter state
 * @returns {Array} Filtered transactions
 */
export function applyFilters(transactions, filterState) {
    return transactions.filter(txn => {
        // Vendor filter (multi-select, OR logic)
        // If vendors array is not empty and transaction vendor is not in selected vendors, exclude
        if (filterState.vendors.length > 0 && !filterState.vendors.includes(txn.vendor)) {
            return false;
        }

        // Station filter (multi-select, OR logic)
        // If stations array is not empty and transaction station is not in selected stations, exclude
        if (filterState.stations.length > 0 && !filterState.stations.includes(txn.station)) {
            return false;
        }

        // Time range filter (based on end_time, inclusive start, exclusive end)
        // IMPORTANT: Transactions are filtered by end_time to match reporting script behavior
        // A transaction ending at "2026-04-24 23:59:59" belongs to April 24
        const endTime = txn.endDate;
        if (endTime < filterState.startTime || endTime >= filterState.endTime) {
            return false;
        }

        return true;
    });
}

/**
 * Get default filter state
 * @param {Object} metadata - Metadata object
 * @returns {FilterState} Default filter state
 */
export function getDefaultFilters(metadata) {
    return new FilterState(metadata);
}

/**
 * Reset filters to defaults
 * @param {Object} metadata - Metadata object
 * @returns {FilterState} Default filter state
 */
export function resetFilters(metadata) {
    return getDefaultFilters(metadata);
}

/**
 * Format date for datetime-local input
 * @param {Date} date - Date object
 * @returns {string} Formatted date string (YYYY-MM-DDTHH:MM)
 */
export function formatDateTimeLocal(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');

    return `${year}-${month}-${day}T${hours}:${minutes}`;
}

/**
 * Parse datetime-local input to Date object
 * @param {string} dateTimeString - Input value from datetime-local
 * @returns {Date} Date object
 */
export function parseDateTimeLocal(dateTimeString) {
    return new Date(dateTimeString);
}
