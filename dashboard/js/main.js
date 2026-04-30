/**
 * Main App Module
 *
 * Dashboard initialization and coordination between all modules.
 */

import { initializeData } from './data-loader.js';
import { FilterState, applyFilters, formatDateTimeLocal, parseDateTimeLocal } from './filters.js';
import { updateCharts } from './charts.js';
import { updateTable, handleSort, handleNextPage, handlePrevPage, resetTableState, setPageSize } from './table.js';

// Global state
let allTransactions = [];
let metadata = null;
let currentFilterState = null;
let filteredTransactions = [];

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
 * Show loading state
 */
function showLoading() {
    document.getElementById('loading').hidden = false;
    document.getElementById('error').hidden = true;
    document.getElementById('charts').hidden = true;
    document.getElementById('table-section').hidden = true;
}

/**
 * Hide loading state
 */
function hideLoading() {
    document.getElementById('loading').hidden = true;
}

/**
 * Show error state
 * @param {string} message - Error message to display
 */
function showError(message) {
    const errorEl = document.getElementById('error');
    const errorMessageEl = errorEl.querySelector('.error-message');
    errorMessageEl.textContent = message;
    errorEl.hidden = false;

    document.getElementById('loading').hidden = true;
    document.getElementById('charts').hidden = true;
    document.getElementById('table-section').hidden = true;
}

/**
 * Show dashboard content
 */
function showDashboard() {
    document.getElementById('loading').hidden = true;
    document.getElementById('error').hidden = true;
    document.getElementById('charts').hidden = false;
    document.getElementById('table-section').hidden = false;

    // Restore charts collapsed state from sessionStorage
    const chartsCollapsed = sessionStorage.getItem('chartsCollapsed') === 'true';
    const chartsEl = document.getElementById('charts');
    const headerEl = document.getElementById('charts-header');

    if (chartsCollapsed) {
        chartsEl.classList.add('collapsed');
        headerEl.classList.add('collapsed');
        headerEl.setAttribute('aria-expanded', 'false');
    }
}

/**
 * Initialize multi-select dropdown
 * @param {string} filterId - ID of the filter container
 * @param {Array} options - Array of option strings
 * @param {Array} selected - Array of selected option strings
 */
function initializeMultiSelect(filterId, options, selected) {
    const filterEl = document.getElementById(filterId);
    const buttonEl = filterEl.querySelector('.multi-select-button');
    const dropdownEl = filterEl.querySelector('.multi-select-dropdown');
    const optionsEl = filterEl.querySelector('.multi-select-options');

    // Populate options
    optionsEl.innerHTML = '';
    options.forEach(option => {
        const div = document.createElement('div');
        div.className = 'multi-select-option';

        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.value = option;
        checkbox.id = `${filterId}-${option}`;
        checkbox.checked = selected.includes(option);

        const label = document.createElement('label');
        label.htmlFor = checkbox.id;
        label.textContent = option;

        div.appendChild(checkbox);
        div.appendChild(label);
        optionsEl.appendChild(div);

        // Handle checkbox changes
        checkbox.addEventListener('change', () => {
            updateMultiSelectDisplay(filterId, options);
        });
    });

    // Toggle dropdown on button click
    buttonEl.addEventListener('click', e => {
        e.stopPropagation();
        dropdownEl.hidden = !dropdownEl.hidden;

        // Close other dropdowns
        document.querySelectorAll('.multi-select-dropdown').forEach(dd => {
            if (dd !== dropdownEl) {
                dd.hidden = true;
            }
        });
    });

    // Close dropdown when clicking outside
    document.addEventListener('click', () => {
        dropdownEl.hidden = true;
    });

    // Prevent dropdown from closing when clicking inside it
    dropdownEl.addEventListener('click', e => {
        e.stopPropagation();
    });

    // Update display
    updateMultiSelectDisplay(filterId, options);
}

/**
 * Update multi-select display text
 * @param {string} filterId - ID of the filter container
 * @param {Array} allOptions - Array of all available options
 */
function updateMultiSelectDisplay(filterId, allOptions) {
    const filterEl = document.getElementById(filterId);
    const selectedCountEl = filterEl.querySelector('.selected-count');
    const checkboxes = filterEl.querySelectorAll('input[type="checkbox"]');

    const selectedCount = Array.from(checkboxes).filter(cb => cb.checked).length;

    if (selectedCount === 0) {
        selectedCountEl.textContent = 'None selected';
    } else if (selectedCount === allOptions.length) {
        selectedCountEl.textContent = filterId.includes('vendor') ? 'All Vendors' : 'All Stations';
    } else {
        selectedCountEl.textContent = `${selectedCount} selected`;
    }
}

/**
 * Get selected values from multi-select
 * @param {string} filterId - ID of the filter container
 * @returns {Array} Array of selected values
 */
function getMultiSelectValues(filterId) {
    const filterEl = document.getElementById(filterId);
    const checkboxes = filterEl.querySelectorAll('input[type="checkbox"]:checked');
    return Array.from(checkboxes).map(cb => cb.value);
}

/**
 * Set filter UI values from filter state
 * @param {FilterState} filterState - Filter state to apply
 */
function setFilterUI(filterState) {
    // Set vendor checkboxes
    const vendorCheckboxes = document.querySelectorAll('#vendor-filter input[type="checkbox"]');
    vendorCheckboxes.forEach(cb => {
        cb.checked = filterState.vendors.includes(cb.value);
    });
    updateMultiSelectDisplay('vendor-filter', metadata.vendors);

    // Set station checkboxes
    const stationCheckboxes = document.querySelectorAll('#station-filter input[type="checkbox"]');
    stationCheckboxes.forEach(cb => {
        cb.checked = filterState.stations.includes(cb.value);
    });
    updateMultiSelectDisplay('station-filter', metadata.stations);

    // Set date inputs
    document.getElementById('start-time').value = formatDateTimeLocal(filterState.startTime);
    document.getElementById('end-time').value = formatDateTimeLocal(filterState.endTime);
}

/**
 * Get current filter state from UI
 * @returns {FilterState} Current filter state
 */
function getFilterStateFromUI() {
    const filterState = currentFilterState.clone();

    // Get selected vendors
    filterState.vendors = getMultiSelectValues('vendor-filter');

    // Get selected stations
    filterState.stations = getMultiSelectValues('station-filter');

    // Get date range
    const startTimeStr = document.getElementById('start-time').value;
    const endTimeStr = document.getElementById('end-time').value;

    if (startTimeStr) {
        filterState.startTime = parseDateTimeLocal(startTimeStr);
    }
    if (endTimeStr) {
        filterState.endTime = parseDateTimeLocal(endTimeStr);
    }

    return filterState;
}

/**
 * Apply filters and update dashboard
 */
function applyFiltersAndUpdate() {
    // Get current filter state from UI
    currentFilterState = getFilterStateFromUI();

    // Apply filters to transactions
    filteredTransactions = applyFilters(allTransactions, currentFilterState);

    // Update charts and table
    updateCharts(filteredTransactions);
    resetTableState();
    updateTable(filteredTransactions);

    console.log(`Filtered to ${filteredTransactions.length} transactions`);
}

/**
 * Reset filters to defaults
 */
function resetFiltersAndUpdate() {
    // Reset filter state to defaults
    currentFilterState = new FilterState(metadata);

    // Update UI
    setFilterUI(currentFilterState);

    // Apply filters
    applyFiltersAndUpdate();
}

/**
 * Initialize dashboard
 */
async function initializeDashboard() {
    showLoading();

    try {
        // Load data
        const data = await initializeData();
        allTransactions = data.transactions;
        metadata = data.metadata;

        console.log(`Loaded ${allTransactions.length} transactions from ${metadata.vendors.length} vendors`);

        // Display last update timestamp
        if (metadata.latest_end_time) {
            // Parse timestamp as local time (same approach as data-loader.js)
            const isoString = metadata.latest_end_time;
            const [datePart, timePart] = isoString.split('T');
            const [year, month, day] = datePart.split('-').map(Number);
            const [hours, minutes, seconds] = timePart.split(':').map(Number);
            const lastUpdate = new Date(year, month - 1, day, hours, minutes, seconds);

            const formatted = formatDateTime(lastUpdate);
            document.getElementById('last-update-time').textContent = formatted;
        }

        // Initialize filter state (last 30 days, all vendors, all stations)
        currentFilterState = new FilterState(metadata);

        // Populate multi-select dropdowns
        initializeMultiSelect('vendor-filter', metadata.vendors, currentFilterState.vendors);
        initializeMultiSelect('station-filter', metadata.stations, currentFilterState.stations);

        // Set date range inputs
        document.getElementById('start-time').value = formatDateTimeLocal(currentFilterState.startTime);
        document.getElementById('end-time').value = formatDateTimeLocal(currentFilterState.endTime);

        // Apply initial filters
        filteredTransactions = applyFilters(allTransactions, currentFilterState);

        // Render initial view
        updateCharts(filteredTransactions);
        updateTable(filteredTransactions);

        // Show dashboard
        hideLoading();
        showDashboard();

        console.log(`Dashboard initialized with ${filteredTransactions.length} transactions`);
    } catch (error) {
        console.error('Failed to initialize dashboard:', error);
        showError(`Failed to load dashboard data: ${error.message}`);
    }
}

/**
 * Setup event listeners
 */
function setupEventListeners() {
    // Apply filters button
    document.getElementById('apply-filters').addEventListener('click', () => {
        applyFiltersAndUpdate();
    });

    // Reset filters button
    document.getElementById('reset-filters').addEventListener('click', () => {
        resetFiltersAndUpdate();
    });

    // Charts collapse/expand toggle
    const chartsHeader = document.getElementById('charts-header');
    const chartsEl = document.getElementById('charts');

    function toggleCharts() {
        chartsEl.classList.toggle('collapsed');
        chartsHeader.classList.toggle('collapsed');

        const isCollapsed = chartsEl.classList.contains('collapsed');
        chartsHeader.setAttribute('aria-expanded', String(!isCollapsed));
        sessionStorage.setItem('chartsCollapsed', isCollapsed);
    }

    chartsHeader.addEventListener('click', toggleCharts);

    chartsHeader.addEventListener('keydown', e => {
        if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            toggleCharts();
        }
    });

    // Table column sorting
    document.querySelectorAll('.transactions-table th.sortable').forEach(th => {
        th.addEventListener('click', () => {
            const column = th.dataset.sort;
            handleSort(column, filteredTransactions);
        });
    });

    // Pagination buttons
    document.getElementById('prev-page').addEventListener('click', () => {
        handlePrevPage(filteredTransactions);
    });

    document.getElementById('next-page').addEventListener('click', () => {
        handleNextPage(filteredTransactions);
    });

    // Page size selector
    document.getElementById('page-size').addEventListener('change', e => {
        const value = e.target.value;
        const size = value === 'all' ? filteredTransactions.length : parseInt(value);
        setPageSize(size);
        updateTable(filteredTransactions);
    });
}

/**
 * Main entry point
 */
document.addEventListener('DOMContentLoaded', () => {
    setupEventListeners();
    initializeDashboard();
});
