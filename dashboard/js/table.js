/**
 * Table Rendering Module
 *
 * Handles table rendering, sorting, pagination, and totals calculation.
 */

// Table state
let currentSort = {
    column: 'end',
    direction: 'desc', // Most recent first by default
};

let currentPage = 1;
let currentPageSize = 50; // Default page size

/**
 * Format date to YYYY-MM-DD HH:MM:SS
 * @param {Date} date - Date object
 * @returns {string} Formatted date string
 */
function formatDateTime(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    const seconds = String(date.getSeconds()).padStart(2, '0');

    return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}

/**
 * Format duration from minutes to HH:MM:SS
 * @param {number} minutes - Duration in minutes
 * @returns {string} Duration in HH:MM:SS format
 */
function formatDuration(minutes) {
    const hours = Math.floor(minutes / 60);
    const mins = Math.floor(minutes % 60);
    const secs = Math.floor((minutes % 1) * 60);

    return `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

/**
 * Format currency with 2 decimals
 * @param {number} amount - Amount in INR
 * @returns {string} Formatted currency string
 */
function formatCurrency(amount) {
    return `₹${amount.toFixed(2)}`;
}

/**
 * Calculate totals from transactions
 * @param {Array} transactions - Transaction array
 * @returns {Object} Totals object
 */
export function calculateTotals(transactions) {
    const count = transactions.length;

    if (count === 0) {
        return {
            count: 0,
            avgDuration: 0,
            totalUnits: 0,
            totalNetRevenue: 0,
            totalGrossRevenue: 0,
        };
    }

    const totalDuration = transactions.reduce((sum, t) => sum + t.duration_minutes, 0);
    const totalUnits = transactions.reduce((sum, t) => sum + t.units_kwh, 0);
    const totalNetRevenue = transactions.reduce((sum, t) => sum + t.net_revenue, 0);
    const totalGrossRevenue = transactions.reduce((sum, t) => sum + t.gross_revenue, 0);

    return {
        count,
        avgDuration: totalDuration / count,
        totalUnits,
        totalNetRevenue,
        totalGrossRevenue,
    };
}

/**
 * Sort transactions by column
 * @param {Array} transactions - Transactions to sort
 * @param {string} column - Column name to sort by
 * @param {string} direction - 'asc' or 'desc'
 * @returns {Array} Sorted transactions (new array)
 */
function sortTransactions(transactions, column, direction) {
    const sorted = [...transactions];

    sorted.sort((a, b) => {
        let aVal, bVal;

        // Get values based on column
        switch (column) {
            case 'id':
                aVal = a.id;
                bVal = b.id;
                break;
            case 'vendor':
                aVal = a.vendor;
                bVal = b.vendor;
                break;
            case 'station':
                aVal = a.station;
                bVal = b.station;
                break;
            case 'start':
                aVal = a.startDate;
                bVal = b.startDate;
                break;
            case 'end':
                aVal = a.endDate;
                bVal = b.endDate;
                break;
            case 'duration_minutes':
                aVal = a.duration_minutes;
                bVal = b.duration_minutes;
                break;
            case 'charger':
                aVal = a.charger;
                bVal = b.charger;
                break;
            case 'units_kwh':
                aVal = a.units_kwh;
                bVal = b.units_kwh;
                break;
            case 'net_revenue':
                aVal = a.net_revenue;
                bVal = b.net_revenue;
                break;
            case 'gross_revenue':
                aVal = a.gross_revenue;
                bVal = b.gross_revenue;
                break;
            default:
                return 0;
        }

        // Compare values
        let comparison = 0;
        if (aVal < bVal) comparison = -1;
        if (aVal > bVal) comparison = 1;

        return direction === 'asc' ? comparison : -comparison;
    });

    return sorted;
}

/**
 * Render table rows
 * @param {Array} transactions - Sorted transactions
 * @param {number} page - Current page (1-indexed)
 */
function renderTableRows(transactions, page) {
    const tbody = document.getElementById('table-body');
    tbody.innerHTML = '';

    // Calculate pagination
    const startIndex = (page - 1) * currentPageSize;
    const endIndex = Math.min(startIndex + currentPageSize, transactions.length);
    const pageTransactions = transactions.slice(startIndex, endIndex);

    // Render rows
    pageTransactions.forEach(txn => {
        const row = document.createElement('tr');

        row.innerHTML = `
            <td>${txn.id}</td>
            <td>${txn.vendor}</td>
            <td>${txn.station}</td>
            <td>${formatDateTime(txn.startDate)}</td>
            <td>${formatDateTime(txn.endDate)}</td>
            <td>${formatDuration(txn.duration_minutes)}</td>
            <td>${txn.charger}-${txn.connector}</td>
            <td>${txn.units_kwh.toFixed(2)}</td>
            <td>${formatCurrency(txn.net_revenue)}</td>
            <td>${formatCurrency(txn.gross_revenue)}</td>
        `;

        tbody.appendChild(row);
    });
}

/**
 * Render totals row
 * @param {Object} totals - Totals object from calculateTotals
 */
function renderTotalsRow(totals) {
    const tfoot = document.getElementById('table-footer');
    tfoot.innerHTML = '';

    const row = document.createElement('tr');
    row.innerHTML = `
        <td>${totals.count} transactions</td>
        <td colspan="4"></td>
        <td>${formatDuration(totals.avgDuration)}</td>
        <td></td>
        <td>${totals.totalUnits.toFixed(2)}</td>
        <td>${formatCurrency(totals.totalNetRevenue)}</td>
        <td>${formatCurrency(totals.totalGrossRevenue)}</td>
    `;

    tfoot.appendChild(row);
}

/**
 * Update table count display
 * @param {number} count - Number of transactions
 */
function updateTableCount(count) {
    const countEl = document.getElementById('table-count');
    countEl.textContent = `${count} transaction${count !== 1 ? 's' : ''}`;
}

/**
 * Update pagination controls
 * @param {number} totalTransactions - Total number of transactions
 * @param {number} currentPage - Current page number
 */
function updatePagination(totalTransactions, currentPage) {
    const totalPages = Math.ceil(totalTransactions / currentPageSize);

    const prevBtn = document.getElementById('prev-page');
    const nextBtn = document.getElementById('next-page');
    const pageInfo = document.getElementById('page-info');

    prevBtn.disabled = currentPage === 1;
    nextBtn.disabled = currentPage >= totalPages || totalPages === 0;

    if (totalPages === 0) {
        pageInfo.textContent = 'Page 0 of 0';
    } else {
        pageInfo.textContent = `Page ${currentPage} of ${totalPages}`;
    }
}

/**
 * Update sort indicators in table headers
 * @param {string} column - Current sort column
 * @param {string} direction - Current sort direction
 */
function updateSortIndicators(column, direction) {
    // Remove all sort classes
    document.querySelectorAll('.transactions-table th').forEach(th => {
        th.classList.remove('sort-asc', 'sort-desc');
    });

    // Add class to current sort column
    const th = document.querySelector(`.transactions-table th[data-sort="${column}"]`);
    if (th) {
        th.classList.add(direction === 'asc' ? 'sort-asc' : 'sort-desc');
    }
}

/**
 * Render complete table with sorting and pagination
 * @param {Array} transactions - Filtered transactions (unsorted)
 */
export function renderTable(transactions) {
    // Sort transactions
    const sorted = sortTransactions(transactions, currentSort.column, currentSort.direction);

    // Render rows for current page
    renderTableRows(sorted, currentPage);

    // Calculate and render totals (for all filtered transactions, not just current page)
    const totals = calculateTotals(transactions);
    renderTotalsRow(totals);

    // Update UI elements
    updateTableCount(transactions.length);
    updatePagination(transactions.length, currentPage);
    updateSortIndicators(currentSort.column, currentSort.direction);
}

/**
 * Update table with new transactions (resets to page 1)
 * @param {Array} transactions - Filtered transactions
 */
export function updateTable(transactions) {
    currentPage = 1; // Reset to first page
    renderTable(transactions);
}

/**
 * Handle sort column click
 * @param {string} column - Column name to sort by
 * @param {Array} transactions - Current filtered transactions
 */
export function handleSort(column, transactions) {
    // Toggle direction if clicking same column, otherwise default to descending
    if (currentSort.column === column) {
        currentSort.direction = currentSort.direction === 'asc' ? 'desc' : 'asc';
    } else {
        currentSort.column = column;
        currentSort.direction = 'desc';
    }

    renderTable(transactions);
}

/**
 * Handle pagination - go to next page
 * @param {Array} transactions - Current filtered transactions
 */
export function handleNextPage(transactions) {
    const totalPages = Math.ceil(transactions.length / currentPageSize);
    if (currentPage < totalPages) {
        currentPage++;
        renderTable(transactions);
    }
}

/**
 * Handle pagination - go to previous page
 * @param {Array} transactions - Current filtered transactions
 */
export function handlePrevPage(transactions) {
    if (currentPage > 1) {
        currentPage--;
        renderTable(transactions);
    }
}

/**
 * Reset table state (useful when filters change)
 */
export function resetTableState() {
    currentPage = 1;
    currentSort = {
        column: 'end',
        direction: 'desc',
    };
}

/**
 * Set page size and reset to first page
 * @param {number} size - New page size
 */
export function setPageSize(size) {
    currentPageSize = size;
    currentPage = 1; // Reset to first page when changing page size
}
