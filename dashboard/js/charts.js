/**
 * Charts Module
 *
 * Renders charts using Chart.js with consistent color mapping across all charts.
 */

// Station color mapping (consistent across all charts)
const STATION_COLORS = {
    'Rajapalayam | Ananda Garden': '#3b82f6',  // Blue
    'Hotel Rayas': '#10b981',                   // Green
    'Nagercoil, Thovalai | Carnival City': '#f59e0b',  // Amber
};

// Fallback color palette for unknown stations
const COLOR_PALETTE = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899'];

// Store chart instances for cleanup
let chartInstances = {
    dailyRevenue: null,
    hourlyUsage: null,
    stationRevenue: null
};

/**
 * Get consistent color for a station
 * @param {string} station - Station name
 * @param {number} index - Fallback index if station not in map
 * @returns {string} Color hex code
 */
function getStationColor(station, index = 0) {
    return STATION_COLORS[station] || COLOR_PALETTE[index % COLOR_PALETTE.length];
}

/**
 * Destroy existing chart instances to prevent memory leaks
 */
export function destroyCharts() {
    Object.values(chartInstances).forEach(chart => {
        if (chart) {
            chart.destroy();
        }
    });
    chartInstances = {
        dailyRevenue: null,
        hourlyUsage: null,
        stationRevenue: null
    };
}

/**
 * Render Daily Net Revenue Chart (stacked column chart by station)
 * @param {Array} transactions - Filtered transactions
 */
export function renderDailyRevenueChart(transactions) {
    const canvas = document.getElementById('daily-revenue-chart');
    const ctx = canvas.getContext('2d');

    // Destroy existing chart
    if (chartInstances.dailyRevenue) {
        chartInstances.dailyRevenue.destroy();
    }

    // Aggregate by date and station
    // IMPORTANT: Use end_time to determine which date a transaction belongs to
    // This ensures consistency with filter logic and reporting scripts
    const dataByDateStation = {};

    transactions.forEach(txn => {
        // Extract date in local timezone (not UTC) to match user's filter expectations
        // Using toISOString() would convert to UTC and shift dates incorrectly
        const year = txn.endDate.getFullYear();
        const month = String(txn.endDate.getMonth() + 1).padStart(2, '0');
        const day = String(txn.endDate.getDate()).padStart(2, '0');
        const date = `${year}-${month}-${day}`;  // YYYY-MM-DD in local timezone
        const station = txn.station;

        if (!dataByDateStation[date]) {
            dataByDateStation[date] = {};
        }
        if (!dataByDateStation[date][station]) {
            dataByDateStation[date][station] = 0;
        }

        dataByDateStation[date][station] += txn.net_revenue;
    });

    // Sort dates
    const dates = Object.keys(dataByDateStation).sort();

    // Get unique stations and assign colors
    const stations = [...new Set(transactions.map(t => t.station))].sort();

    // Build datasets (one per station)
    const datasets = stations.map((station, index) => ({
        label: station,
        data: dates.map(date => dataByDateStation[date][station] || 0),
        backgroundColor: getStationColor(station, index),
        borderColor: getStationColor(station, index),
        borderWidth: 1
    }));

    chartInstances.dailyRevenue = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: dates,
            datasets: datasets
        },
        options: {
            responsive: true,
            maintainAspectRatio: true,
            plugins: {
                legend: {
                    display: true,
                    position: 'top'
                },
                tooltip: {
                    mode: 'index',
                    intersect: false,
                    callbacks: {
                        label: function(context) {
                            return `${context.dataset.label}: ₹${context.parsed.y.toFixed(2)}`;
                        }
                    }
                }
            },
            scales: {
                x: {
                    stacked: true,
                    title: {
                        display: true,
                        text: 'Date'
                    }
                },
                y: {
                    stacked: true,
                    beginAtZero: true,
                    title: {
                        display: true,
                        text: 'Net Revenue (₹)'
                    },
                    ticks: {
                        callback: function(value) {
                            return '₹' + value.toLocaleString();
                        }
                    }
                }
            }
        }
    });
}

/**
 * Render Hourly Usage Chart (column chart showing kWh by hour of day)
 * @param {Array} transactions - Filtered transactions
 */
export function renderHourlyUsageChart(transactions) {
    const canvas = document.getElementById('hourly-usage-chart');
    const ctx = canvas.getContext('2d');

    // Destroy existing chart
    if (chartInstances.hourlyUsage) {
        chartInstances.hourlyUsage.destroy();
    }

    // Aggregate by hour (0-23, based on end_time)
    // IMPORTANT: Use end_time hour to determine which hour a transaction belongs to
    const usageByHour = new Array(24).fill(0);

    transactions.forEach(txn => {
        const hour = txn.endDate.getHours();  // Extract hour from end_time
        usageByHour[hour] += txn.units_kwh;
    });

    const hours = Array.from({length: 24}, (_, i) => i);

    chartInstances.hourlyUsage = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: hours.map(h => `${h}:00`),
            datasets: [{
                label: 'Energy Usage (kWh)',
                data: usageByHour,
                backgroundColor: '#3b82f6',
                borderColor: '#2563eb',
                borderWidth: 1
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: true,
            plugins: {
                legend: {
                    display: false
                },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            const hour = context.dataIndex;
                            const nextHour = (hour + 1) % 24;
                            return `${hour}:00-${nextHour}:00: ${context.parsed.y.toFixed(2)} kWh`;
                        }
                    }
                }
            },
            scales: {
                x: {
                    title: {
                        display: true,
                        text: 'Hour of Day'
                    }
                },
                y: {
                    beginAtZero: true,
                    title: {
                        display: true,
                        text: 'Energy (kWh)'
                    },
                    ticks: {
                        callback: function(value) {
                            return value.toFixed(0) + ' kWh';
                        }
                    }
                }
            }
        }
    });
}

/**
 * Render Station Revenue Chart (pie chart)
 * @param {Array} transactions - Filtered transactions
 */
export function renderStationRevenueChart(transactions) {
    const canvas = document.getElementById('station-revenue-chart');
    const ctx = canvas.getContext('2d');

    // Destroy existing chart
    if (chartInstances.stationRevenue) {
        chartInstances.stationRevenue.destroy();
    }

    // Aggregate revenue by station
    const revenueByStation = {};

    transactions.forEach(txn => {
        const station = txn.station;
        if (!revenueByStation[station]) {
            revenueByStation[station] = 0;
        }
        revenueByStation[station] += txn.net_revenue;
    });

    // Sort stations by revenue (descending)
    const stations = Object.keys(revenueByStation).sort((a, b) =>
        revenueByStation[b] - revenueByStation[a]
    );

    const revenues = stations.map(s => revenueByStation[s]);
    const colors = stations.map((s, i) => getStationColor(s, i));

    // Calculate total for percentages
    const total = revenues.reduce((sum, val) => sum + val, 0);

    chartInstances.stationRevenue = new Chart(ctx, {
        type: 'pie',
        data: {
            labels: stations,
            datasets: [{
                data: revenues,
                backgroundColor: colors,
                borderColor: '#ffffff',
                borderWidth: 2
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: true,
            plugins: {
                legend: {
                    display: true,
                    position: 'bottom'
                },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            const revenue = context.parsed;
                            const percentage = ((revenue / total) * 100).toFixed(1);
                            return `${context.label}: ₹${revenue.toFixed(2)} (${percentage}%)`;
                        }
                    }
                },
                datalabels: {
                    color: '#ffffff',
                    font: {
                        weight: 'bold',
                        size: 14
                    },
                    formatter: function(value, context) {
                        const percentage = ((value / total) * 100).toFixed(2);
                        // Format: ₹12,345.67 (45.23%)
                        const formattedValue = value.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
                        return '₹' + formattedValue + '\n(' + percentage + '%)';
                    },
                    anchor: 'center',
                    align: 'center'
                }
            }
        },
        plugins: [ChartDataLabels]
    });
}

/**
 * Update all charts with filtered transactions
 * @param {Array} transactions - Filtered transactions
 */
export function updateCharts(transactions) {
    renderDailyRevenueChart(transactions);
    renderHourlyUsageChart(transactions);
    renderStationRevenueChart(transactions);
}
