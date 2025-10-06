/**
 * Enhanced Load Balancer Frontend - ML Features Integration
 * Extends existing functionality with AI predictions and advanced analytics
 */

// ==================== CONFIGURATION ====================
const CONFIG = {
    API_BASE_URL: 'http://localhost:5000',
    REFRESH_INTERVAL: 10000,
    MAX_CAPACITY: 100,
    WARNING_THRESHOLD: 70,
    CRITICAL_THRESHOLD: 90,
    LIFESPAN_CRITICAL: 3,
    LIFESPAN_WARNING: 7,
    BREAKAGE_CRITICAL: 60,
    BREAKAGE_WARNING: 30
};

// ==================== GLOBAL STATE ====================
let state = {
    lines: [],
    alerts: [],
    isConnected: false,
    autoRefresh: false,
    refreshTimer: null,
    redistributionCount: 0,
    predictions: {},
    lifespanData: {},
    beforeRedistribution: null
};

// ==================== INITIALIZATION ====================
document.addEventListener('DOMContentLoaded', () => {
    console.log('🚀 EPOCH Load Balancer Enhanced - Initializing...');
    initializeApp();
    setupEventListeners();
});

async function initializeApp() {
    addLog('System initializing with ML capabilities...', 'info');
    await connectToBackend();
    await fetchLoadData();
    await fetchAlerts();
    updateStats();
    addLog('System ready - ML models active', 'success');
}

// ==================== BACKEND CONNECTION ====================
async function connectToBackend() {
    const statusBadge = document.getElementById('backendStatus') || document.getElementById('connectionStatus');
    const statusDot = document.getElementById('statusDot');
    const statusText = document.getElementById('statusText');
    
    try {
        const response = await fetch(`${CONFIG.API_BASE_URL}/health`);
        if (response.ok) {
            const data = await response.json();
            state.isConnected = true;
            
            if (statusBadge) {
                statusBadge.classList.add('connected');
                statusBadge.classList.remove('disconnected');
            }
            if (statusDot) statusDot.className = 'status-dot connected';
            if (statusText) statusText.textContent = 'Connected';
            
            addLog(`Connected to backend: ${data.service}`, 'success');
            return true;
        }
    } catch (error) {
        state.isConnected = false;
        if (statusBadge) {
            statusBadge.classList.add('disconnected');
            statusBadge.classList.remove('connected');
        }
        if (statusDot) statusDot.className = 'status-dot disconnected';
        if (statusText) statusText.textContent = 'Disconnected';
        
        addLog('Failed to connect to backend. Using mock data.', 'warning');
        initializeMockData();
        return false;
    }
}

function initializeMockData() {
    state.lines = [
        { line_id: 'LT001', line_name: 'Line Alpha', current_load: 85, capacity: 100, load_percentage: 85.0, breakage_probability: 42, predicted_lifespan_years: 8.5, age_years: 8.5 },
        { line_id: 'LT002', line_name: 'Line Beta', current_load: 65, capacity: 100, load_percentage: 65.0, breakage_probability: 18, predicted_lifespan_years: 12.3, age_years: 5.2 },
        { line_id: 'LT003', line_name: 'Line Gamma', current_load: 92, capacity: 100, load_percentage: 92.0, breakage_probability: 68, predicted_lifespan_years: 2.8, age_years: 12.3 },
        { line_id: 'LT004', line_name: 'Line Delta', current_load: 45, capacity: 100, load_percentage: 45.0, breakage_probability: 8, predicted_lifespan_years: 15.2, age_years: 3.1 },
        { line_id: 'LT005', line_name: 'Line Epsilon', current_load: 78, capacity: 100, load_percentage: 78.0, breakage_probability: 35, predicted_lifespan_years: 6.7, age_years: 9.7 }
    ];
    renderLTLines();
    updateStats();
}

// ==================== DATA FETCHING ====================
async function fetchLoadData() {
    try {
        if (!state.isConnected) return;
        
        const response = await fetch(`${CONFIG.API_BASE_URL}/get_load_data`);
        if (response.ok) {
            const data = await response.json();
            state.lines = data.lt_lines || [];
            
            updateDashboard(data);
            updateLastUpdateTime();
            checkForOverload(data);
            
            return data;
        }
    } catch (error) {
        console.error('Error fetching load data:', error);
        addLog(`Error fetching data: ${error.message}`, 'error');
    }
}

async function fetchAlerts() {
    try {
        if (!state.isConnected) return;
        
        const response = await fetch(`${CONFIG.API_BASE_URL}/alerts`);
        if (response.ok) {
            const data = await response.json();
            state.alerts = data.alerts || [];
            displayAlerts(data.alerts);
        }
    } catch (error) {
        console.error('Error fetching alerts:', error);
    }
}

async function predictFailure(lineId = null) {
    try {
        const response = await fetch(`${CONFIG.API_BASE_URL}/predict_failure`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ line_id: lineId })
        });
        
        if (response.ok) {
            const data = await response.json();
            state.predictions = data;
            
            if (lineId) {
                addLog(`Failure prediction for ${lineId}: ${data.breakage_probability}% risk`, 
                    data.risk_level === 'critical' ? 'error' : 'warning');
            } else {
                addLog('Failure predictions updated for all lines', 'success');
            }
            
            await fetchLoadData(); // Refresh to show updated predictions
            return data;
        }
    } catch (error) {
        console.error('Error predicting failure:', error);
        addLog('Failed to predict failure probability', 'error');
    }
}

async function predictLifespan(lineId = null) {
    try {
        const response = await fetch(`${CONFIG.API_BASE_URL}/lifespan_prediction`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ line_id: lineId })
        });
        
        if (response.ok) {
            const data = await response.json();
            state.lifespanData = data;
            
            if (lineId) {
                addLog(`Lifespan prediction for ${lineId}: ${data.predicted_lifespan_years} years remaining`, 
                    data.status === 'urgent' ? 'error' : data.status === 'attention' ? 'warning' : 'success');
            } else {
                addLog('Lifespan predictions updated for all lines', 'success');
            }
            
            await fetchLoadData();
            displayLifespanModal(data);
            return data;
        }
    } catch (error) {
        console.error('Error predicting lifespan:', error);
        addLog('Failed to predict lifespan', 'error');
    }
}

// ==================== DASHBOARD UPDATE ====================
function updateDashboard(data) {
    updateStatsCards(data);
    updateLTLinesTable(data);
    renderLTLines();
    updateStats();
}

function updateStatsCards(data) {
    const totalLines = data.lt_lines?.length || state.lines.length;
    const lines = data.lt_lines || state.lines;
    
    const criticalLines = lines.filter(line => line.load_percentage > CONFIG.CRITICAL_THRESHOLD).length;
    const avgLoad = lines.length > 0 
        ? lines.reduce((sum, line) => sum + line.load_percentage, 0) / lines.length 
        : 0;
    const maxRisk = lines.length > 0 
        ? Math.max(...lines.map(line => line.breakage_probability || 0)) 
        : 0;
    
    // Update UI elements
    const totalLinesEl = document.getElementById('totalLines');
    const criticalLinesEl = document.getElementById('criticalLines') || document.getElementById('overloadedLines');
    const avgLoadEl = document.getElementById('avgLoad');
    const riskScoreEl = document.getElementById('riskScore');
    const redistributionCountEl = document.getElementById('redistributionCount');
    
    if (totalLinesEl) totalLinesEl.textContent = totalLines;
    if (criticalLinesEl) criticalLinesEl.textContent = criticalLines;
    if (avgLoadEl) avgLoadEl.textContent = `${avgLoad.toFixed(1)}%`;
    if (riskScoreEl) riskScoreEl.textContent = `${maxRisk.toFixed(1)}%`;
    if (redistributionCountEl) redistributionCountEl.textContent = state.redistributionCount;
}

function updateLTLinesTable(data) {
    const tbody = document.getElementById('ltLinesBody');
    if (!tbody) return;
    
    tbody.innerHTML = '';
    const lines = data.lt_lines || state.lines;
    
    lines.forEach(line => {
        const row = document.createElement('tr');
        row.className = 'report-row';
        
        const statusClass = getLoadStatusClass(line.load_percentage);
        const statusText = getLoadStatusText(line.load_percentage);
        
        row.innerHTML = `
            <td><strong>${line.line_id}</strong></td>
            <td>${line.line_name}</td>
            <td>
                <div style="background: rgba(30, 41, 59, 0.8); border-radius: 4px; overflow: hidden; height: 8px;">
                    <div style="width: ${Math.min(line.load_percentage, 100)}%; height: 100%; background: ${getProgressColor(line.load_percentage)}; transition: width 0.3s;"></div>
                </div>
            </td>
            <td><strong>${line.load_percentage.toFixed(1)}%</strong></td>
            <td>
                <span style="color: ${getRiskColor(line.breakage_probability / 100)}; font-weight: 600;">
                    ${line.breakage_probability?.toFixed(1) || 0}%
                </span>
            </td>
            <td><span class="status-badge status-${statusClass}">${statusText}</span></td>
            <td>
                <button class="btn btn-secondary" style="padding: 6px 12px; font-size: 12px;" 
                    onclick="redistributeSingleLine('${line.line_id}')">
                    <i class="fas fa-sync-alt"></i> Redistribute
                </button>
            </td>
        `;
        
        tbody.appendChild(row);
    });
}

function renderLTLines() {
    const grid = document.getElementById('ltLinesGrid');
    if (!grid) return;
    
    grid.innerHTML = '';
    
    state.lines.forEach(line => {
        const loadPercentage = line.load_percentage || (line.current_load / line.capacity) * 100;
        const status = getLineStatus(loadPercentage);
        const card = createEnhancedLineCard(line, loadPercentage, status);
        grid.appendChild(card);
    });
}

function createEnhancedLineCard(line, loadPercentage, status) {
    const card = document.createElement('div');
    card.className = 'line-card';
    
    const statusClass = status.class;
    const progressClass = `progress-${statusClass}`;
    const lifespanStatus = getLifespanStatus(line.predicted_lifespan_years);
    const breakageRisk = getBreakageRiskLevel(line.breakage_probability);
    
    card.innerHTML = `
        <div class="line-header">
            <div class="line-id">${line.line_id}</div>
            <span class="status-badge status-${statusClass}">${status.label}</span>
        </div>
        
        <div class="load-info">
            <div class="load-value">${line.current_load?.toFixed(1) || 0} kW</div>
            <div class="load-label">${line.line_name}</div>
        </div>
        
        <div class="progress-container">
            <div class="progress-bar">
                <div class="progress-fill ${progressClass}" style="width: ${loadPercentage}%"></div>
            </div>
            <div class="capacity-info">
                <span>${loadPercentage.toFixed(1)}% Load</span>
                <span>Capacity: ${line.capacity} kW</span>
            </div>
        </div>
        
        <div style="margin-top: 15px; padding-top: 15px; border-top: 1px solid rgba(51, 65, 85, 0.5);">
            <div style="display: flex; justify-content: space-between; margin-bottom: 10px;">
                <span style="font-size: 12px; color: var(--text-muted);">
                    <i class="fas fa-exclamation-triangle"></i> Failure Risk
                </span>
                <span style="font-size: 16px; font-weight: 600; color: ${getRiskColor(line.breakage_probability / 100)};">
                    ${(line.breakage_probability || 0).toFixed(1)}% ${breakageRisk.icon}
                </span>
            </div>
            <div style="display: flex; justify-content: space-between;">
                <span style="font-size: 12px; color: var(--text-muted);">
                    <i class="fas fa-clock"></i> Est. Lifespan
                </span>
                <span style="font-size: 14px; font-weight: 600; color: ${lifespanStatus.color};">
                    ${(line.predicted_lifespan_years || 0).toFixed(1)} years ${lifespanStatus.icon}
                </span>
            </div>
        </div>
        
        <div style="margin-top: 12px; display: flex; gap: 8px;">
            <button class="btn btn-secondary" style="flex: 1; padding: 8px; font-size: 11px;" 
                onclick="showLineDetails('${line.line_id}')">
                <i class="fas fa-info-circle"></i> Details
            </button>
            <button class="btn btn-primary" style="flex: 1; padding: 8px; font-size: 11px;" 
                onclick="redistributeSingleLine('${line.line_id}')">
                <i class="fas fa-sync-alt"></i> Balance
            </button>
        </div>
    `;
    
    return card;
}

// ==================== HELPER FUNCTIONS ====================
function getLineStatus(loadPercentage) {
    if (loadPercentage > CONFIG.CRITICAL_THRESHOLD) {
        return { class: 'critical', label: 'Critical' };
    } else if (loadPercentage > CONFIG.WARNING_THRESHOLD) {
        return { class: 'warning', label: 'Warning' };
    } else {
        return { class: 'normal', label: 'Normal' };
    }
}

function getLoadStatusClass(percentage) {
    if (percentage <= 70) return 'safe';
    if (percentage <= 90) return 'warning';
    return 'danger';
}

function getLoadStatusText(percentage) {
    if (percentage <= 70) return 'Safe';
    if (percentage <= 90) return 'Warning';
    return 'Overload';
}

function getRiskColor(probability) {
    if (probability > 0.6) return '#ef4444';
    if (probability > 0.3) return '#f59e0b';
    return '#10b981';
}

function getProgressColor(percentage) {
    if (percentage <= 70) return 'linear-gradient(90deg, #10b981, #34d399)';
    if (percentage <= 90) return 'linear-gradient(90deg, #f59e0b, #fbbf24)';
    return 'linear-gradient(90deg, #ef4444, #dc2626)';
}

function getLifespanStatus(years) {
    if (years < CONFIG.LIFESPAN_CRITICAL) {
        return { color: '#ef4444', icon: '⚠️', status: 'urgent' };
    } else if (years < CONFIG.LIFESPAN_WARNING) {
        return { color: '#f59e0b', icon: '⚡', status: 'attention' };
    }
    return { color: '#10b981', icon: '✓', status: 'good' };
}

function getBreakageRiskLevel(probability) {
    if (probability > CONFIG.BREAKAGE_CRITICAL) {
        return { level: 'critical', icon: '🔴', label: 'Critical' };
    } else if (probability > CONFIG.BREAKAGE_WARNING) {
        return { level: 'warning', icon: '🟡', label: 'Warning' };
    }
    return { level: 'low', icon: '🟢', label: 'Low' };
}

function updateStats() {
    const totalLines = state.lines.length;
    const overloadedLines = state.lines.filter(line => 
        (line.load_percentage || (line.current_load / line.capacity) * 100) > CONFIG.CRITICAL_THRESHOLD
    ).length;
    
    const avgLoad = state.lines.length > 0
        ? state.lines.reduce((sum, line) => sum + (line.load_percentage || 0), 0) / state.lines.length
        : 0;
    
    const totalLinesEl = document.getElementById('totalLines');
    const overloadedLinesEl = document.getElementById('overloadedLines') || document.getElementById('criticalLines');
    const avgLoadEl = document.getElementById('avgLoad');
    const redistributionCountEl = document.getElementById('redistributionCount');
    
    if (totalLinesEl) totalLinesEl.textContent = totalLines;
    if (overloadedLinesEl) overloadedLinesEl.textContent = overloadedLines;
    if (avgLoadEl) avgLoadEl.textContent = `${avgLoad.toFixed(1)}%`;
    if (redistributionCountEl) redistributionCountEl.textContent = state.redistributionCount;
}

// ==================== ALERT HANDLING ====================
function displayAlerts(alerts) {
    const criticalAlerts = alerts.filter(a => a.type === 'critical');
    
    if (criticalAlerts.length > 0) {
        const alertMessages = criticalAlerts.map(a => a.message).join(' | ');
        showAlert(alertMessages);
    } else {
        closeAlert();
    }
}

function checkForOverload(data) {
    const lines = data.lt_lines || state.lines;
    const overloadedLines = lines.filter(line => line.load_percentage > CONFIG.CRITICAL_THRESHOLD);
    
    if (overloadedLines.length > 0) {
        const lineNames = overloadedLines.map(line => line.line_name).join(', ');
        showAlert(`Overload risk detected on: ${lineNames}`);
    } else {
        closeAlert();
    }
}

function showAlert(message) {
    const alertBanner = document.getElementById('alertBanner');
    const alertMessage = document.getElementById('alertMessage');
    
    if (alertBanner && alertMessage) {
        alertMessage.textContent = message;
        alertBanner.style.display = 'flex';
    }
}

function closeAlert() {
    const alertBanner = document.getElementById('alertBanner');
    if (alertBanner) {
        alertBanner.style.display = 'none';
    }
}

// ==================== LOAD REDISTRIBUTION ====================
async function redistributeLoad() {
    const btn = document.getElementById('redistributeBtn');
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<span class="spinner"></span> Redistributing...';
    }
    
    addLog('Initiating intelligent load redistribution...', 'info');
    
    try {
        state.beforeRedistribution = JSON.parse(JSON.stringify(state.lines));
        
        const response = await fetch(`${CONFIG.API_BASE_URL}/redistribute_load`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({})
        });
        
        if (response.ok) {
            const data = await response.json();
            state.lines = data.lt_lines || state.lines;
            state.redistributionCount++;
            
            addLog('Load redistribution completed successfully', 'success');
            addLog(`Improvement: ${data.improvement_percentage?.toFixed(1) || 0}% risk reduction`, 'success');
            
            if (data.redistribution_report) {
                const transfers = data.redistribution_report.transfers_count || 0;
                addLog(`Completed ${transfers} load transfers`, 'success');
            }
            
            updateDashboard(data);
            showRedistributionModal(state.beforeRedistribution, data);
        } else {
            throw new Error('Redistribution failed');
        }
    } catch (error) {
        console.error('Redistribution error:', error);
        addLog(`Redistribution failed: ${error.message}`, 'error');
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = '<i class="fas fa-random"></i> Redistribute Load';
        }
    }
}

async function redistributeSingleLine(lineId) {
    addLog(`Redistributing load for ${lineId}...`, 'info');
    
    try {
        state.beforeRedistribution = JSON.parse(JSON.stringify(state.lines));
        
        const response = await fetch(`${CONFIG.API_BASE_URL}/redistribute_load`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ line_id: lineId })
        });
        
        if (response.ok) {
            const data = await response.json();
            state.lines = data.lt_lines || state.lines;
            state.redistributionCount++;
            
            addLog(`Load redistributed for ${lineId}`, 'success');
            updateDashboard(data);
            showRedistributionModal(state.beforeRedistribution, data);
        }
    } catch (error) {
        console.error('Redistribution error:', error);
        addLog('Failed to redistribute load', 'error');
    }
}

async function redistributeAllLoads() {
    return redistributeLoad();
}

// ==================== MODALS ====================
function showRedistributionModal(beforeData, afterData) {
    const modal = document.getElementById('redistributionModal');
    const modalBody = document.getElementById('modalBody');
    
    if (!modal || !modalBody) return;
    
    let tableHTML = `
        <div style="margin-bottom: 20px;">
            <h4 style="color: var(--text-primary); margin-bottom: 10px;">Redistribution Summary</h4>
            <p style="color: var(--text-secondary); font-size: 14px;">
                Risk Improvement: <strong style="color: var(--success-color);">${afterData.improvement_percentage?.toFixed(1) || 0}%</strong>
            </p>
        </div>
        <table class="table" style="background: transparent;">
            <thead>
                <tr>
                    <th>Line</th>
                    <th>Before (%)</th>
                    <th>After (%)</th>
                    <th>Change</th>
                </tr>
            </thead>
            <tbody>
    `;
    
    const afterLines = afterData.lt_lines || [];
    beforeData.forEach((beforeLine, index) => {
        const afterLine = afterLines[index];
        if (!afterLine) return;
        
        const beforePct = beforeLine.load_percentage || 0;
        const afterPct = afterLine.load_percentage || 0;
        const change = afterPct - beforePct;
        const changeClass = change < -1 ? 'safe' : change > 1 ? 'danger' : 'warning';
        const changeIcon = change < -1 ? '↓' : change > 1 ? '↑' : '→';
        
        tableHTML += `
            <tr>
                <td><strong>${beforeLine.line_name}</strong></td>
                <td>${beforePct.toFixed(1)}%</td>
                <td>${afterPct.toFixed(1)}%</td>
                <td><span class="status-badge status-${changeClass}">${changeIcon} ${Math.abs(change).toFixed(1)}%</span></td>
            </tr>
        `;
    });
    
    tableHTML += `</tbody></table>`;
    
    modalBody.innerHTML = tableHTML;
    modal.style.display = 'flex';
}

function displayLifespanModal(data) {
    // Create a simple notification instead of modal if not exists
    const predictions = data.lifespan_predictions || [data];
    predictions.forEach(pred => {
        addLog(`${pred.line_name}: ${pred.predicted_lifespan_years} years remaining (${pred.status})`, 
            pred.status === 'urgent' ? 'error' : pred.status === 'attention' ? 'warning' : 'success');
    });
}

function showLineDetails(lineId) {
    const line = state.lines.find(l => l.line_id === lineId);
    if (!line) return;
    
    const details = `
        Line ID: ${line.line_id}
        Name: ${line.line_name}
        Current Load: ${line.current_load?.toFixed(1) || 0} kW
        Load Percentage: ${line.load_percentage?.toFixed(1) || 0}%
        Breakage Risk: ${line.breakage_probability?.toFixed(1) || 0}%
        Predicted Lifespan: ${line.predicted_lifespan_years?.toFixed(1) || 0} years
        Age: ${line.age_years?.toFixed(1) || 0} years
    `;
    
    addLog(details, 'info');
}

function closeModal() {
    const modal = document.getElementById('redistributionModal');
    if (modal) modal.style.display = 'none';
}

// ==================== SYSTEM CONTROLS ====================
async function refreshData() {
    addLog('Refreshing all data...', 'info');
    await fetchLoadData();
    await fetchAlerts();
    updateStats();
    addLog('Data refreshed successfully', 'success');
}

async function resetSystem() {
    if (!confirm('Are you sure you want to reset the system to initial state?')) return;
    
    try {
        addLog('Resetting system...', 'info');
        
        const response = await fetch(`${CONFIG.API_BASE_URL}/reset_system`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        });
        
        if (response.ok) {
            const data = await response.json();
            state.lines = data.lt_lines || [];
            state.redistributionCount = 0;
            state.beforeRedistribution = null;
            
            updateDashboard(data);
            addLog('System reset successfully', 'success');
        }
    } catch (error) {
        console.error('Reset error:', error);
        addLog('Failed to reset system', 'error');
    }
}

function toggleAutoRefresh() {
    state.autoRefresh = !state.autoRefresh;
    const btn = document.getElementById('autoRefreshText');
    
    if (state.autoRefresh) {
        if (btn) btn.textContent = 'Disable Auto-Refresh';
        state.refreshTimer = setInterval(refreshData, CONFIG.REFRESH_INTERVAL);
        addLog(`Auto-refresh enabled (${CONFIG.REFRESH_INTERVAL / 1000}s interval)`, 'success');
    } else {
        if (btn) btn.textContent = 'Enable Auto-Refresh';
        if (state.refreshTimer) {
            clearInterval(state.refreshTimer);
            state.refreshTimer = null;
        }
        addLog('Auto-refresh disabled', 'info');
    }
}

function startAutoRefresh() {
    state.refreshTimer = setInterval(refreshData, CONFIG.REFRESH_INTERVAL);
}

function stopAutoRefresh() {
    if (state.refreshTimer) {
        clearInterval(state.refreshTimer);
        state.refreshTimer = null;
    }
}

// ==================== LOGGING ====================
function addLog(message, type = 'info') {
    const log = document.getElementById('redistributionLog');
    if (!log) {
        console.log(`[${type.toUpperCase()}] ${message}`);
        return;
    }
    
    const entry = document.createElement('div');
    entry.className = `log-entry ${type}`;
    
    const timestamp = new Date().toLocaleTimeString();
    entry.innerHTML = `
        <span class="log-time">[${timestamp}]</span> ${message}
    `;
    
    log.insertBefore(entry, log.firstChild);
    
    // Keep only last 20 entries
    while (log.children.length > 20) {
        log.removeChild(log.lastChild);
    }
}

function updateLastUpdateTime() {
    const lastUpdate = document.getElementById('lastUpdate');
    if (lastUpdate) {
        const now = new Date();
        lastUpdate.textContent = now.toLocaleTimeString();
    }
}

// ==================== EVENT LISTENERS ====================
function setupEventListeners() {
    // Cleanup on page unload
    window.addEventListener('beforeunload', () => {
        stopAutoRefresh();
    });
    
    // Handle modal clicks
    window.addEventListener('click', (event) => {
        const modal = document.getElementById('redistributionModal');
        if (modal && event.target === modal) {
            closeModal();
        }
    });
}

// ==================== CHART FUNCTIONS ====================
function showChart(mode) {
    // This function is called from the HTML for chart toggle
    console.log(`Chart mode changed to: ${mode}`);
}

// Export functions for global access
window.redistributeLoad = redistributeLoad;
window.redistributeSingleLine = redistributeSingleLine;
window.redistributeAllLoads = redistributeAllLoads;
window.refreshData = refreshData;
window.resetSystem = resetSystem;
window.toggleAutoRefresh = toggleAutoRefresh;
window.closeAlert = closeAlert;
window.closeModal = closeModal;
window.showChart = showChart;
window.showLineDetails = showLineDetails;
window.predictFailure = predictFailure;
window.predictLifespan = predictLifespan;