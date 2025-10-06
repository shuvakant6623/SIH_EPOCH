// dashboard.js - EPOCH Dashboard (Emergency Power Outage Control Hub)
// LT Line Break Detection & Control System for KSEBL

document.addEventListener('DOMContentLoaded', async function () {
    // Backend Configuration
    const BACKEND_URL = 'http://localhost:5000';
    let backendConnected = false;

    // Check backend connectivity on startup
    async function checkBackendConnection() {
        try {
            const response = await fetch(`${BACKEND_URL}/health`);
            if (response.ok) {
                backendConnected = true;
                updateUIForBackendStatus(true);
                showNotification('AI Detection System connected successfully!', 'success');
            }
        } catch (err) {
            backendConnected = false;
            updateUIForBackendStatus(false);
            showNotification('AI Detection System offline - using fallback scoring', 'warning');
        }
    }

    // Real-time report analysis function
    async function analyzeReportWithBackend(reportText, location) {
        if (!backendConnected) {
            return calculateFallbackAuthenticityScore(reportText, location);
        }

        try {
            const response = await fetch(`${BACKEND_URL}/analyze-report`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    reportText: reportText,
                    location: location
                })
            });

            if (!response.ok) {
                throw new Error(`Backend error: ${response.status}`);
            }

            const analysis = await response.json();
            return {
                authenticityScore: analysis.authenticityScore,
                classification: analysis.classification,
                hazardType: analysis.hazardType,
                urgency: analysis.urgency,
                summary: analysis.summary,
                analysis: analysis.analysis
            };

        } catch (err) {
            console.error('Backend analysis failed:', err);
            return calculateFallbackAuthenticityScore(reportText, location);
        }
    }

    // Fallback function when backend is unavailable
    function calculateFallbackAuthenticityScore(reportText, location) {
        const score = calculateAuthenticityScore({
            description: reportText,
            location_name: location,
            hazard_type: 'line_break'
        });

        return {
            authenticityScore: score,
            classification: score >= 70 ? 'Authentic' : 'Needs Verification',
            hazardType: 'line_break',
            urgency: score >= 80 ? 'High' : score >= 50 ? 'Medium' : 'Low',
            summary: `Report from ${location} - Score: ${score}/100`,
            analysis: {
                keywordMatch: false,
                locationCompatible: true,
                similarReports: 0,
                detectedHazard: 'line_break'
            }
        };
    }

    // Initialize backend connection
    await checkBackendConnection();

    const API_BASE_URL = 'http://127.0.0.1:8001';
    const REFRESH_INTERVAL = 30000; // 30s

    let refreshInterval;
    let map;
    let heatmapLayer;
    let markersLayer;
    let currentHazards = [];

    // Authenticity Score Calculation System (adapted for LT Line Breaks)
    const AUTHENTICITY_CONFIG = {
        hazardKeywords: {
            line_break: ['line break', 'wire down', 'cable snap', 'power line', 'conductor', 'fallen wire', 'broken line', 'live wire'],
            overload: ['overload', 'overcurrent', 'excessive load', 'circuit overload', 'transformer overload'],
            short_circuit: ['short circuit', 'sparking', 'arc flash', 'electrical fault', 'ground fault'],
            fallen_line: ['fallen line', 'sagging wire', 'drooping cable', 'wire touching ground', 'line on road'],
            power_surge: ['power surge', 'voltage spike', 'electrical surge', 'surge damage'],
            transformer_failure: ['transformer', 'transformer failure', 'transformer blast', 'transformer fire', 'blown transformer'],
            electrical_fire: ['electrical fire', 'fire', 'burning', 'smoke', 'flames from pole']
        },
        locationData: {
            'thiruvananthapuram': ['line_break', 'fallen_line', 'transformer_failure', 'overload'],
            'kochi': ['line_break', 'short_circuit', 'transformer_failure', 'electrical_fire'],
            'kozhikode': ['line_break', 'fallen_line', 'overload', 'transformer_failure'],
            'thrissur': ['line_break', 'overload', 'transformer_failure'],
            'kollam': ['line_break', 'fallen_line', 'short_circuit'],
            'palakkad': ['line_break', 'overload', 'transformer_failure'],
            'malappuram': ['line_break', 'fallen_line', 'overload'],
            'kannur': ['line_break', 'transformer_failure', 'short_circuit'],
            'alappuzha': ['line_break', 'fallen_line', 'transformer_failure'],
            'kottayam': ['line_break', 'overload', 'short_circuit']
        },
        weights: {
            keywordMatch: 40,
            locationMatch: 30,
            similarReports: 30
        }
    };

    function calculateAuthenticityScore(report) {
        let score = 0;
        const description = (report.description || '').toLowerCase();
        const location = (report.location_name || report.location || '').toLowerCase();
        const hazardType = (report.hazard_type || report.type || '').toLowerCase();

        const keywords = AUTHENTICITY_CONFIG.hazardKeywords[hazardType] || [];
        const keywordMatches = keywords.filter(keyword => 
            description.includes(keyword.toLowerCase())
        ).length;
        
        if (keywordMatches > 0) {
            score += Math.min(AUTHENTICITY_CONFIG.weights.keywordMatch, 
                             keywordMatches * 15);
        }

        const locationCompatible = checkLocationCompatibility(location, hazardType);
        if (locationCompatible) {
            score += AUTHENTICITY_CONFIG.weights.locationMatch;
        }

        const similarReportsScore = calculateSimilarReportsScore(report);
        score += similarReportsScore;

        if (description.length > 50) score += 5;
        if (description.length < 20) score -= 10;

        return Math.max(0, Math.min(100, Math.round(score)));
    }

    function checkLocationCompatibility(location, hazardType) {
        for (const [region, possibleHazards] of Object.entries(AUTHENTICITY_CONFIG.locationData)) {
            if (location.includes(region)) {
                return possibleHazards.includes(hazardType);
            }
        }
        return true;
    }

    function calculateSimilarReportsScore(report) {
        const latitude = parseFloat(report.latitude) || 0;
        const longitude = parseFloat(report.longitude) || 0;
        
        let similarCount = 0;
        
        currentHazards.forEach(hazard => {
            if (hazard.id === report.id) return;
            
            const latDiff = Math.abs(parseFloat(hazard.lat) - latitude);
            const lngDiff = Math.abs(parseFloat(hazard.lng) - longitude);
            
            if (latDiff < 0.5 && lngDiff < 0.5) {
                if (hazard.type === report.hazard_type || hazard.type === report.type) {
                    similarCount++;
                }
            }
        });
        
        if (similarCount >= 3) return 30;
        if (similarCount >= 2) return 20;
        if (similarCount >= 1) return 15;
        return 0;
    }

    function getAuthenticityBadge(score) {
        if (score >= 70) {
            return {
                html: '<span class="authenticity-badge authentic"><i class="fas fa-check-circle"></i> Authentic</span>',
                class: 'authentic',
                text: 'Authentic'
            };
        } else {
            return {
                html: '<span class="authenticity-badge needs-verification"><i class="fas fa-exclamation-triangle"></i> Needs Verification</span>',
                class: 'needs-verification',
                text: 'Needs Verification'
            };
        }
    }

    /* ---------------- helpers ---------------- */
    function escapeHtml(unsafe) {
        if (unsafe === undefined || unsafe === null) return '';
        return String(unsafe)
            .replaceAll('&','&amp;')
            .replaceAll('<','&lt;')
            .replaceAll('>','&gt;')
            .replaceAll('"','&quot;')
            .replaceAll("'", '&#039;');
    }

    function showNotification(message, type = 'info') {
        const notification = document.createElement('div');
        notification.className = `alert alert-${type === 'success' ? 'success' : type === 'error' || type === 'danger' ? 'danger' : type === 'warning' ? 'warning' : 'info'} alert-dismissible fade show`;
        notification.style.cssText = `
            background: var(--bg-secondary);
            color: var(--text-primary);
            border: 1px solid var(--border-color);
            border-left: 4px solid var(--${type === 'success' ? 'success' : type === 'error' || type === 'danger' ? 'error' : type === 'warning' ? 'warning' : 'info'}-color);
            box-shadow: var(--shadow-lg);
            border-radius: 8px;
            min-width: 300px;
            margin-bottom: 10px;
        `;
        
        notification.innerHTML = `
            <div style="display: flex; align-items: center; gap: 12px;">
                <i class="fas fa-${type === 'success' ? 'check-circle' : type === 'error' || type === 'danger' ? 'exclamation-circle' : type === 'warning' ? 'exclamation-triangle' : 'info-circle'}" 
                   style="color: var(--${type === 'success' ? 'success' : type === 'error' || type === 'danger' ? 'error' : type === 'warning' ? 'warning' : 'info'}-color);"></i>
                <span>${escapeHtml(message)}</span>
                <button type="button" class="btn-close" data-bs-dismiss="alert" aria-label="Close" style="filter: invert(1);"></button>
            </div>
        `;
        
        let container = document.querySelector('.notification-container');
        if (!container) {
            container = document.createElement('div');
            container.className = 'notification-container';
            container.style.cssText = 'position: fixed; top: 90px; right: 24px; z-index: 1050; max-width: 350px;';
            document.body.appendChild(container);
        }
        container.appendChild(notification);
        
        if (type !== 'danger' && type !== 'error') {
            setTimeout(() => {
                if (notification.parentNode) {
                    notification.remove();
                }
            }, 5000);
        }
    }

    async function apiCall(endpoint, options = {}) {
        const url = `${API_BASE_URL}${endpoint}`;
        const opts = { ...options };

        if (opts.body && !(opts.body instanceof FormData) && typeof opts.body === 'object') {
            opts.body = JSON.stringify(opts.body);
            opts.headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
        } else {
            opts.headers = { ...(opts.headers || {}) };
        }

        try {
            const res = await fetch(url, opts);
            const text = await res.text();
            let json = null;
            try { json = text ? JSON.parse(text) : null; } catch (e) { json = null; }

            if (!res.ok) {
                const errMsg = (json && (json.detail || json.message)) || res.statusText || `HTTP ${res.status}`;
                const err = new Error(errMsg);
                err.status = res.status;
                err.body = json || text;
                throw err;
            }
            return json;
        } catch (err) {
            console.error('apiCall error', endpoint, err, err?.body ?? '');
            throw err;
        }
    }

    function formatHazardType(type) {
        if (!type) return 'Other';
        return String(type).replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
    }

    function formatTimestamp(ts) {
        if (!ts) return 'N/A';
        const d = new Date(ts);
        if (isNaN(d)) return ts;
        return new Intl.DateTimeFormat('en-IN', {
            timeZone: 'Asia/Kolkata',
            dateStyle: 'short',
            timeStyle: 'short'
        }).format(d);
    }

    function getSeverityLevel(sev) {
        const n = Number(sev || 0);
        if (n >= 4) return 'high';
        if (n >= 2) return 'medium';
        return 'low';
    }

    function renderSeverityStars(severity) {
        const s = Math.max(0, Math.min(5, Number(severity) || 0));
        const stars = '★'.repeat(s) + '☆'.repeat(5 - s);
        const color = s >= 4 ? 'var(--error-color)' : s >= 3 ? 'var(--warning-color)' : 'var(--info-color)';
        return `<span style="color: ${color}">${stars}</span>`;
    }

    function getStatusColor(status) {
        const s = (status || '').toString().toLowerCase();
        const colors = {
            'verified': 'success',
            'pending': 'warning', 
            'under review': 'info',
            'rejected': 'danger',
            'urgent': 'danger',
            'high_priority': 'warning',
            'standard': 'primary',
            'informational': 'info'
        };
        return colors[s] || 'secondary';
    }

    function getHazardColor(typeTitleCase) {
        const colors = {
            'Line Break': 'danger',
            'Overload': 'warning',
            'Short Circuit': 'danger',
            'Fallen Line': 'warning',
            'Power Surge': 'info',
            'Transformer Failure': 'danger',
            'Electrical Fire': 'danger'
        };
        return colors[typeTitleCase] || 'dark';
    }

    /* ---------------- heatmap implementation ---------------- */
    function initializeMap() {
        const mapElement = document.getElementById('map');
        if (!mapElement) {
            console.warn('Map element not found');
            return;
        }
        
        // Center map on Kerala
        map = L.map('map').setView([10.8505, 76.2711], 7);

        L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
            attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
            subdomains: 'abcd',
            maxZoom: 20
        }).addTo(map);

        L.control.scale().addTo(map);

        markersLayer = L.layerGroup().addTo(map);
        
        addHeatmapLegend();
        setupMapInteractions();
    }

    function createHeatmapData(hazards) {
        const heatmapData = hazards.map(hazard => {
            const severityWeight = (hazard.severityRaw || 1) / 5;
            
            const typeMultipliers = {
                'line_break': 1.0,
                'fallen_line': 0.9,
                'transformer_failure': 0.9,
                'short_circuit': 0.8,
                'electrical_fire': 0.95,
                'overload': 0.7,
                'power_surge': 0.6,
                'other': 0.6
            };
            
            const typeMultiplier = typeMultipliers[hazard.type] || typeMultipliers.other;
            const intensity = severityWeight * typeMultiplier;
            
            return [hazard.lat, hazard.lng, intensity];
        });

        return heatmapData;
    }

    function updateHeatmap() {
        if (!map) return;
        
        if (heatmapLayer) {
            map.removeLayer(heatmapLayer);
        }

        const heatmapData = createHeatmapData(currentHazards);
        
        if (heatmapData.length === 0) {
            console.log('No heatmap data to display');
            return;
        }

        const intensitySlider = document.getElementById('heatmapIntensity');
        const radiusSlider = document.getElementById('heatmapRadius');
        
        const intensity = intensitySlider ? parseFloat(intensitySlider.value) : 1.0;
        const radius = radiusSlider ? parseInt(radiusSlider.value) : 35;

        heatmapLayer = L.heatLayer(heatmapData, {
            radius: radius,
            blur: Math.max(15, radius * 0.6),
            maxZoom: 17,
            max: intensity,
            minOpacity: 0.4,
            gradient: {
                0.0: '#065f46',
                0.2: '#059669',
                0.4: '#3b82f6',
                0.6: '#f59e0b',
                0.8: '#ef4444',
                1.0: '#dc2626'
            }
        }).addTo(map);

        updateMapMarkers();
    }

    window.updateHeatmapSettings = function() {
        if (!map || !heatmapLayer) return;
        
        const heatmapData = createHeatmapData(currentHazards);
        
        if (heatmapData.length === 0) return;
        
        const intensitySlider = document.getElementById('heatmapIntensity');
        const radiusSlider = document.getElementById('heatmapRadius');
        
        const intensity = intensitySlider ? parseFloat(intensitySlider.value) : 1.0;
        const radius = radiusSlider ? parseInt(radiusSlider.value) : 35;
        
        if (heatmapLayer) {
            map.removeLayer(heatmapLayer);
        }
        
        heatmapLayer = L.heatLayer(heatmapData, {
            radius: radius,
            blur: Math.max(15, radius * 0.6),
            maxZoom: 17,
            max: intensity,
            minOpacity: 0.4,
            gradient: {
                0.0: '#065f46',
                0.2: '#059669',
                0.4: '#3b82f6',
                0.6: '#f59e0b',
                0.8: '#ef4444',
                1.0: '#dc2626'
            }
        }).addTo(map);
    };

    function addHeatmapLegend() {
        const legend = L.control({ position: 'bottomright' });
        legend.onAdd = function () {
            const div = L.DomUtil.create('div', 'info legend');
            div.style.cssText = `
                background: var(--bg-secondary);
                color: var(--text-primary);
                padding: 12px;
                border-radius: 8px;
                border: 1px solid var(--border-color);
                box-shadow: var(--shadow-lg);
                z-index: 1000;
                pointer-events: auto;
                font-size: 12px;
                min-width: 140px;
            `;
            div.innerHTML = `
                <h4 style="margin:0 0 8px 0; color: var(--text-primary);">Line Break Intensity</h4>
                <div style="margin: 4px 0; display: flex; align-items: center;">
                    <span style="display:inline-block;width:15px;height:10px;background:#dc2626;margin-right:6px;border-radius:2px;"></span> 
                    <span>Critical</span>
                </div>
                <div style="margin: 4px 0; display: flex; align-items: center;">
                    <span style="display:inline-block;width:15px;height:10px;background:#ef4444;margin-right:6px;border-radius:2px;"></span> 
                    <span>High</span>
                </div>
                <div style="margin: 4px 0; display: flex; align-items: center;">
                    <span style="display:inline-block;width:15px;height:10px;background:#f59e0b;margin-right:6px;border-radius:2px;"></span> 
                    <span>Medium</span>
                </div>
                <div style="margin: 4px 0; display: flex; align-items: center;">
                    <span style="display:inline-block;width:15px;height:10px;background:#3b82f6;margin-right:6px;border-radius:2px;"></span> 
                    <span>Low</span>
                </div>
                <div style="margin: 4px 0; display: flex; align-items: center;">
                    <span style="display:inline-block;width:15px;height:10px;background:#065f46;margin-right:6px;border-radius:2px;"></span> 
                    <span>Minimal</span>
                </div>
                <hr style="border-color: var(--border-color); margin: 8px 0;">
                <div style="font-size: 11px; color: var(--text-muted);">
                    <i class="fas fa-info-circle"></i> Click map to report
                </div>
            `;
            return div;
        };
        legend.addTo(map);
    }

    function setupMapInteractions() {
        if (!map) return;
        map.on('click', function (e) {
            const uid = Date.now();
            const lat = e.latlng.lat;
            const lng = e.latlng.lng;

            const selectHtml = `
                <select id="quickHazardType_${uid}" class="form-select form-select-sm mb-2" aria-label="Select hazard type" style="background: var(--bg-tertiary); border: 1px solid var(--border-color); color: var(--text-primary);">
                    <option value="line_break">LT Line Break</option>
                    <option value="overload">Overload</option>
                    <option value="short_circuit">Short Circuit</option>
                    <option value="fallen_line">Fallen Line</option>
                    <option value="power_surge">Power Surge</option>
                    <option value="transformer_failure">Transformer Failure</option>
                    <option value="electrical_fire">Electrical Fire</option>
                    <option value="other">Other</option>
                </select>
            `;

            const popupHtml = `
                <div style="min-width:240px; color: var(--bg-primary);">
                    <h5 style="margin:0 0 6px 0; color: var(--bg-primary);">Quick Report</h5>
                    <p style="margin:0 0 6px 0; color: var(--bg-primary);">Location: ${lat.toFixed(4)}, ${lng.toFixed(4)}</p>
                    ${selectHtml}
                    <div class="d-flex gap-2">
                        <button id="qrBtn_${uid}" class="btn btn-sm btn-primary">Report Line Break</button>
                        <button id="qrClose_${uid}" class="btn btn-sm btn-secondary">Close</button>
                    </div>
                </div>
            `;

            const popup = L.popup()
                .setLatLng(e.latlng)
                .setContent(popupHtml)
                .openOn(map);

            setTimeout(() => {
                const btn = document.getElementById(`qrBtn_${uid}`);
                const closeBtn = document.getElementById(`qrClose_${uid}`);
                const sel = document.getElementById(`quickHazardType_${uid}`);

                if (btn) {
                    btn.addEventListener('click', () => {
                        const hazardType = (sel && sel.value) ? sel.value : 'line_break';
                        if (typeof window.quickReport === 'function') {
                            window.quickReport(lat, lng, hazardType);
                        }
                        if (map) map.closePopup();
                    });
                }
                if (closeBtn) closeBtn.addEventListener('click', () => map.closePopup());
            }, 50);
        });
    }

    /* ---------- quickReport with backend integration ---------- */
    window.quickReport = async function (lat, lng, hazardType = 'line_break') {
        const form = new FormData();
        form.append('user_id', 'user_' + Date.now());
        form.append('latitude', String(lat));
        form.append('longitude', String(lng));
        form.append('hazard_type', hazardType);
        form.append('severity', String(3));
        form.append('description', 'Quick report from map click - LT line break detected');
        form.append('location_name', `Location at ${lat.toFixed(4)}, ${lng.toFixed(4)}`);

        try {
            showNotification('Analyzing report...', 'info');
            
            const analysis = await analyzeReportWithBackend(
                'Quick report from map click - LT line break detected',
                `Location at ${lat.toFixed(4)}, ${lng.toFixed(4)}`
            );

            showNotification(
                `Report Analysis Complete! Score: ${analysis.authenticityScore}/100 - ${analysis.classification}`,
                analysis.authenticityScore >= 70 ? 'success' : 'warning'
            );

            const res = await fetch(`${API_BASE_URL}/api/reports/submit`, {
                method: 'POST',
                body: form
            });

            if (!res.ok) {
                const txt = await res.text().catch(() => '');
                throw new Error(txt || res.statusText || `HTTP ${res.status}`);
            }

            const data = await res.json().catch(() => ({}));
            
            showNotification(
                `Report submitted: ${data.report_id || 'ok'} | ${analysis.hazardType} detected with ${analysis.urgency} urgency`,
                'success'
            );

            if (typeof window.refreshHazards === 'function') {
                await window.refreshHazards();
            }
        } catch (err) {
            console.error('quickReport error', err);
            showNotification(`Failed to submit report: ${err.message}`, 'danger');
        }
    };

    /* ---------- fetch & render data ---------- */
    async function fetchHazardData() {
        try {
            const data = await apiCall('/api/reports/active?hours=48');

            let reports = [];
            if (data && Array.isArray(data.reports)) {
                reports = data.reports;
            } else if (Array.isArray(data)) {
                reports = data;
            } else {
                console.warn("Unexpected API response format:", data);
                reports = [];
            }

            currentHazards = [];
            for (const report of reports) {
                let authenticityScore = report.authenticityScore;
                let authenticityBadge = report.authenticityBadge;
                
                if (!authenticityScore) {
                    if (backendConnected) {
                        try {
                            const analysis = await analyzeReportWithBackend(
                                report.description || '',
                                report.location_name || report.location || ''
                            );
                            authenticityScore = analysis.authenticityScore;
                            authenticityBadge = getAuthenticityBadge(authenticityScore);
                        } catch (err) {
                            authenticityScore = calculateAuthenticityScore(report);
                            authenticityBadge = getAuthenticityBadge(authenticityScore);
                        }
                    } else {
                        authenticityScore = calculateAuthenticityScore(report);
                        authenticityBadge = getAuthenticityBadge(authenticityScore);
                    }
                }

                currentHazards.push({
                    id: report.id,
                    lat: report.latitude,
                    lng: report.longitude,
                    type: report.hazard_type || report.type || 'line_break',
                    severityRaw: report.severity ?? report.severity_raw ?? 0,
                    severity: getSeverityLevel(report.severity ?? report.severity_raw ?? 0),
                    title: `${report.location_name || report.location || 'Unknown'} - ${formatHazardType(report.hazard_type || report.type || 'line_break')}`,
                    description: report.description || '',
                    timestamp: report.timestamp || report.created_at || null,
                    status: report.verification_status || report.status || 'Pending',
                    priority: report.priority_score || report.priority || null,
                    media_urls: report.media_urls || [],
                    authenticityScore: authenticityScore,
                    authenticityBadge: authenticityBadge
                });
            }

            updateHeatmap();
            return currentHazards;

        } catch (err) {
            console.error('Error fetching hazard data:', err);
            currentHazards = getSampleHazardData();
            updateHeatmap();
            return currentHazards;
        }
    }

    function getSampleHazardData() {
        const sampleReports = [
            { 
                id: 'sample_1', 
                lat: 8.5241, 
                lng: 76.9366, 
                type: 'line_break', 
                severity: 'high', 
                severityRaw: 4,
                title: 'Thiruvananthapuram - LT Line Break',
                description: 'Major line break detected on LT line near residential area. Wire down and sparking.',
                timestamp: new Date().toISOString(),
                status: 'Verified',
                location_name: 'Thiruvananthapuram'
            },
            { 
                id: 'sample_2',
                lat: 9.9312, 
                lng: 76.2673, 
                type: 'transformer_failure', 
                severity: 'medium',
                severityRaw: 3,
                title: 'Kochi - Transformer Failure',
                description: 'Transformer overload reported. Load shedding required in area.',
                timestamp: new Date().toISOString(),
                status: 'Pending',
                location_name: 'Kochi'
            },
            { 
                id: 'sample_3',
                lat: 11.2588, 
                lng: 75.7804, 
                type: 'fallen_line', 
                severity: 'low',
                severityRaw: 2,
                title: 'Kozhikode - Fallen Line',
                description: 'Fallen LT line near highway. Immediate attention required.',
                timestamp: new Date().toISOString(),
                status: 'Verified',
                location_name: 'Kozhikode'
            }
        ];

        return sampleReports.map(report => {
            const authenticityScore = calculateAuthenticityScore(report);
            return {
                ...report,
                authenticityScore: authenticityScore,
                authenticityBadge: getAuthenticityBadge(authenticityScore)
            };
        });
    }

    function updateMapMarkers() {
        if (!markersLayer) return;
        markersLayer.clearLayers();
        
        if (map.getZoom() >= 10) {
            currentHazards.forEach(hazard => {
                const { marker } = createHazardMarker(hazard) || {};
                if (marker) markersLayer.addLayer(marker);
            });
        }
        
        map.off('zoomend', handleZoomChange);
        map.on('zoomend', handleZoomChange);
    }

    function handleZoomChange() {
        if (!markersLayer) return;
        
        if (map.getZoom() >= 10) {
            markersLayer.clearLayers();
            currentHazards.forEach(hazard => {
                const { marker } = createHazardMarker(hazard) || {};
                if (marker) markersLayer.addLayer(marker);
            });
        } else {
            markersLayer.clearLayers();
        }
    }

    function createHazardMarker(hazard) {
        const markerColors = {
            line_break: '#ff4444',
            overload: '#FF8800',
            short_circuit: '#ff4444',
            fallen_line: '#FF8800',
            power_surge: '#33b5e5',
            transformer_failure: '#ff4444',
            electrical_fire: '#dc2626',
            other: '#ff9933'
        };
        
        const typeKey = (hazard.type || 'line_break').toLowerCase();
        const color = markerColors[typeKey] || markerColors.other;
        
        const marker = L.marker([hazard.lat, hazard.lng], {
            icon: L.divIcon({
                className: 'hazard-marker',
                html: `<div style="background-color: ${color}; width: 16px; height: 16px; border-radius: 50%; border: 2px solid white; box-shadow: 0 0 8px rgba(0,0,0,0.6); position: relative;">
                    <div style="position: absolute; top: -2px; left: -2px; width: 20px; height: 20px; border-radius: 50%; border: 2px solid ${color}; animation: pulse 2s infinite;"></div>
                </div>`,
                iconSize: [20, 20]
            })
        });
        
        marker.bindPopup(`
            <div class="hazard-popup" style="min-width:300px; color: var(--bg-primary);">
                <h5 style="color: var(--bg-primary);">${escapeHtml(hazard.title || formatHazardType(hazard.type))}</h5>
                <p><strong>Type:</strong> ${escapeHtml(formatHazardType(hazard.type))}</p>
                <p><strong>Severity:</strong> ${escapeHtml(hazard.severity || hazard.severityRaw?.toString() || 'N/A')}</p>
                <p><strong>Status:</strong> ${escapeHtml(hazard.status || 'Pending')}</p>
                <div style="margin: 8px 0; padding: 12px; background: rgba(0,0,0,0.1); border-radius: 6px; border: 1px solid rgba(255,255,255,0.1);">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
                        <strong style="color: var(--bg-primary);">Authenticity Analysis:</strong>
                        <span style="font-size: 16px; font-weight: bold; color: ${hazard.authenticityScore >= 70 ? '#10b981' : '#f59e0b'};">${hazard.authenticityScore || 0}/100</span>
                    </div>
                    <div style="font-size: 12px; color: var(--bg-primary); opacity: 0.8;">
                        ${hazard.authenticityBadge?.text || 'Unknown'} | 
                        ${backendConnected ? 'AI-Powered Analysis' : 'Fallback Scoring'}
                    </div>
                </div>
                ${hazard.priority ? `<p><strong>Priority:</strong> ${Number(hazard.priority).toFixed(1)}</p>` : ''}
                <p><strong>Time:</strong> ${formatTimestamp(hazard.timestamp)}</p>
                ${hazard.description ? `<p><strong>Description:</strong> ${escapeHtml(hazard.description)}</p>` : ''}
                <button class="btn btn-sm btn-primary" onclick="viewReportDetails('${escapeHtml(hazard.id)}')">View Full Analysis</button>
            </div>
        `);

        marker.on('click', function() {
            updateHotspotInfo(hazard);
        });

        return { marker };
    }

    function updateHotspotInfo(report) {
        const infoPanel = document.getElementById('hotspotInfo');
        if (!infoPanel) return;
        
        const getHazardIcon = (type) => {
            const icons = {
                line_break: 'fa-bolt',
                overload: 'fa-exclamation-triangle',
                short_circuit: 'fa-bolt',
                fallen_line: 'fa-arrow-down',
                power_surge: 'fa-bolt',
                transformer_failure: 'fa-box',
                electrical_fire: 'fa-fire'
            };
            return icons[type] || 'fa-exclamation-triangle';
        };

        const getSeverityColor = (severity) => {
            const colors = {
                1: '#10b981', 2: '#3b82f6', 3: '#f59e0b', 4: '#ef4444', 5: '#dc2626'
            };
            return colors[severity] || '#6b7280';
        };

        const getSeverityLabel = (severity) => {
            const labels = {
                1: 'Low', 2: 'Low-Medium', 3: 'Medium', 4: 'High', 5: 'Critical'
            };
            return labels[severity] || 'Unknown';
        };

        infoPanel.innerHTML = `
            <h4><i class="fas fa-map-pin"></i> ${escapeHtml(report.title)}</h4>
            <div style="margin: 16px 0;">
                <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 8px;">
                    <i class="fas ${getHazardIcon(report.type)}" style="color: ${getSeverityColor(report.severityRaw)};"></i>
                    <strong>${formatHazardType(report.type)}</strong>
                </div>
                <p style="color: var(--text-secondary); margin: 4px 0;">
                    <strong>Severity:</strong> ${report.severityRaw}/5 (${getSeverityLabel(report.severityRaw)})
                </p>
                <div style="margin: 12px 0; padding: 16px; background: var(--bg-tertiary); border-radius: 8px; border: 1px solid var(--border-color);">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
                        <strong style="color: var(--text-primary);">AI Authenticity Analysis</strong>
                        <span style="font-size: 20px; font-weight: bold; color: ${report.authenticityScore >= 70 ? 'var(--success-color)' : 'var(--warning-color)'};">${report.authenticityScore || 0}/100</span>
                    </div>
                    <div style="margin: 8px 0;">
                        ${report.authenticityBadge?.html || '<span class="authenticity-badge">Unknown</span>'}
                    </div>
                    <div style="font-size: 11px; color: var(--text-muted); margin-top: 8px;">
                        <i class="fas fa-robot"></i> ${backendConnected ? 'Real-time AI analysis active' : 'Backend offline - using fallback scoring'}
                    </div>
                </div>
                <p style="color: var(--text-secondary); margin: 4px 0;">
                    <strong>Reported:</strong> ${formatTimestamp(report.timestamp)}
                </p>
                <p style="color: var(--text-secondary); margin: 4px 0;">
                    <strong>Coordinates:</strong> ${report.lat.toFixed(4)}, ${report.lng.toFixed(4)}
                </p>
                <p style="color: var(--text-secondary); margin: 4px 0;">
                    <strong>Status:</strong> ${escapeHtml(report.status)}
                </p>
            </div>
            <div style="display: flex; gap: 12px; margin-top: 16px;">
                <button class="btn btn-primary" onclick="viewReportDetails('${escapeHtml(report.id)}')">
                    <i class="fas fa-eye"></i> View Full Analysis
                </button>
                <button class="btn btn-secondary" onclick="showCreateAlertModal('${escapeHtml(report.id)}')">
                    <i class="fas fa-bell"></i> Alert Control Room
                </button>
            </div>
        `;
    }

    /* ---------- dashboard stats ---------- */
    async function fetchDashboardStats() {
        try {
            if (backendConnected) {
                try {
                    const backendStats = await fetch(`${BACKEND_URL}/stats`);
                    if (backendStats.ok) {
                        const stats = await backendStats.json();
                        updateStatCards({
                            total_reports: stats.totalReports || 0,
                            active_reports: stats.authenticReports || 0,
                            resolved_reports: stats.verificationNeeded || 0,
                            hotspot_count: Object.keys(stats.hazardBreakdown || {}).length
                        });
                        const lastUpdatedEl = document.getElementById('lastUpdated');
                        if (lastUpdatedEl) lastUpdatedEl.textContent = formatTimestamp(new Date().toISOString());
                        return;
                    }
                } catch (err) {
                    console.warn('Backend stats unavailable, falling back to main API');
                }
            }

            const data = await apiCall('/api/dashboard/stats');
            updateStatCards(data || {});
            const lastUpdatedEl = document.getElementById('lastUpdated');
            if (lastUpdatedEl) lastUpdatedEl.textContent = formatTimestamp(new Date().toISOString());
        } catch (err) {
            console.error('Error fetching dashboard stats:', err);
            updateStatCards({ total_reports: 0, active_reports: 0, resolved_reports: 0 });
        }
    }

    function updateStatCards(data) {
        const mapping = {
            totalReports: data.total_reports || data.totalReports || 0,
            activeHazards: data.active_reports || data.active_hazards || data.activeHazards || 0,
            hotspotCount: data.hotspot_count || data.hotspotCount || 0,
            highPriorityAlerts: data.resolved_reports || data.high_priority_alerts || 0,
            authenticReports: data.authentic_reports || data.authenticReports || 0,
            pendingVerification: data.pending_verification || data.pendingVerification || 0
        };
        Object.entries(mapping).forEach(([id, value]) => {
            const el = document.getElementById(id);
            if (el) animateValue(el, parseInt(el.textContent) || 0, Number(value) || 0, 500);
        });
    }

    function animateValue(element, start, end, duration) {
        const range = end - start;
        const stepTime = Math.max(Math.floor(duration / Math.abs(range || 1)), 10);
        let current = start;
        const inc = range > 0 ? 1 : -1;
        const timer = setInterval(() => {
            current += inc;
            element.textContent = current;
            if ((inc > 0 && current >= end) || (inc < 0 && current <= end)) {
                element.textContent = end;
                clearInterval(timer);
            }
        }, stepTime);
    }

    /* ---------- recent reports ---------- */
    async function fetchRecentReports() {
        const tbody = document.querySelector('#reportsTable tbody');
        if (!tbody) return;
        try {
            const data = await apiCall('/api/dashboard/reports');
            const reports = (data && data.reports) ? data.reports : (Array.isArray(data) ? data : []);
            if (reports.length) {
                renderReportsTable(tbody, reports);
            } else {
                tbody.innerHTML = '<tr><td colspan="7" class="text-center">No recent reports</td></tr>';
            }
        } catch (err) {
            console.error('Error fetching recent reports:', err);
            tbody.innerHTML = '<tr><td colspan="7" class="text-center text-danger">Error loading reports</td></tr>';
        }
    }

    function renderReportsTable(tbody, reports) {
        tbody.innerHTML = reports.map(report => {
            const type = report.hazard_type || report.type || 'line_break';
            const location = report.location_name || report.location || 'Unknown';
            const severity = report.severity ?? report.severity_raw ?? 0;
            const status = report.verification_status || report.status || 'Pending';
            const reportId = report.id || '';
            
            let authenticityScore = report.authenticityScore;
            let authenticityBadge = report.authenticityBadge;
            
            if (!authenticityScore) {
                authenticityScore = calculateAuthenticityScore(report);
                authenticityBadge = getAuthenticityBadge(authenticityScore);
            }
            
            return `
            <tr class="report-row" data-report-id="${escapeHtml(reportId)}" style="cursor:pointer;">
                <td>${escapeHtml(String(reportId).slice(0,8))}...</td>
                <td><span class="badge bg-${getHazardColor(formatHazardType(type))}">${escapeHtml(formatHazardType(type))}</span></td>
                <td>${escapeHtml(location)}</td>
                <td>${renderSeverityStars(Number(severity))}</td>
                <td>
                    <div class="authenticity-cell">
                        <div class="authenticity-score-mini">${authenticityScore}/100</div>
                        <div class="authenticity-badge-mini ${authenticityBadge.class}">
                            ${authenticityBadge.text}
                            ${backendConnected ? '<i class="fas fa-robot" style="margin-left: 4px; font-size: 8px;" title="AI Analyzed"></i>' : ''}
                        </div>
                    </div>
                </td>
                <td>${formatTimestamp(report.timestamp || report.created_at || '')}</td>
                <td><span class="badge bg-${getStatusColor(status)}">${escapeHtml(status)}</span></td>
            </tr>
            `;
        }).join('');

        const rows = tbody.querySelectorAll('.report-row');
        rows.forEach(row => {
            const id = row.dataset.reportId;
            if (id) {
                row.addEventListener('click', () => viewReportDetails(id));
            }
        });
    }

    /* ---------- Authority Alerts Functions ---------- */
    async function fetchAuthorityAlerts() {
        const container = document.getElementById('alertsList');
        if (!container) return;

        try {
            container.innerHTML = '<div class="text-center"><i class="fas fa-spinner fa-spin"></i> Loading alerts...</div>';
            const data = await apiCall('/api/alerts');
            const alerts = Array.isArray(data) ? data : [];
            
            if (alerts.length === 0) {
                container.innerHTML = '<div class="text-muted text-center">No control room alerts found</div>';
                return;
            }

            renderAuthorityAlerts(container, alerts);
        } catch (err) {
            console.error('Error fetching authority alerts:', err);
            container.innerHTML = '<div class="alert alert-danger">Error loading control room alerts</div>';
        }
    }

    function renderAuthorityAlerts(container, alerts) {
        container.innerHTML = alerts.map(alert => `
            <div class="alert-card">
                <div class="alert-header">
                    <div class="alert-title">Alert ID: ${escapeHtml(alert.id.slice(0, 8))}...</div>
                    <div class="alert-time">${formatTimestamp(alert.timestamp)}</div>
                </div>
                <div style="margin-bottom: 12px;">
                    <small class="text-muted">Report: ${escapeHtml(alert.report_id.slice(0, 8))}...</small>
                    <span class="badge bg-${getStatusColor(alert.status)} ms-2">${escapeHtml(formatAuthorityType(alert.authority_type))}</span>
                </div>
                <div class="alert-description">
                    ${escapeHtml(alert.message)}
                </div>
                <div class="alert-actions">
                    <button class="btn btn-outline-primary" onclick="viewReportDetails('${escapeHtml(alert.report_id)}')">
                        <i class="fas fa-eye"></i> View Related Report
                    </button>
                    <span class="badge bg-${getStatusColor(alert.status)}">${escapeHtml(alert.status)}</span>
                </div>
            </div>
        `).join('');
    }

    function formatAuthorityType(type) {
        const typeMap = {
            'control_room': 'KSEBL Control Room',
            'field_operations': 'Field Operations',
            'maintenance': 'Maintenance Team',
            'emergency_response': 'Emergency Response',
            'technical_support': 'Technical Support',
            'safety_team': 'Safety Team'
        };
        return typeMap[type] || type.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
    }

    function showCreateAlertModal(reportId = '') {
        const modal = document.getElementById('authorityAlertModal');
        const reportIdInput = document.getElementById('alertReportId');
        
        if (reportId && reportIdInput) {
            reportIdInput.value = reportId;
        }
        
        const bsModal = new bootstrap.Modal(modal);
        bsModal.show();
    }

    async function submitAuthorityAlert(alertData) {
        try {
            const response = await apiCall('/api/alerts', {
                method: 'POST',
                body: alertData
            });

            showNotification('Control room alert sent successfully!', 'success');
            
            const activeTab = document.querySelector('.tab-btn.active');
            if (activeTab && activeTab.getAttribute('data-tab') === 'alerts') {
                await fetchAuthorityAlerts();
            }
            
            return response;
        } catch (err) {
            console.error('Error submitting authority alert:', err);
            throw err;
        }
    }

    /* ---------- report details & verification ---------- */
    window.viewReportDetails = async function (reportId) {
        try {
            const data = await apiCall(`/api/reports/${reportId}`);
            showReportDetailsModal(data);
        } catch (err) {
            console.error('viewReportDetails error', err);
            showNotification('Failed to load report details', 'danger');
        }
    };

    function showReportDetailsModal(report) {
        if (!report) { showNotification('Report not found', 'warning'); return; }

        const rid = report.id || '';
        const locationName = escapeHtml(report.location_name || report.location || 'Not specified');
        const coords = `${escapeHtml(String(report.latitude ?? 'N/A'))}, ${escapeHtml(String(report.longitude ?? 'N/A'))}`;
        const hazardType = escapeHtml(formatHazardType(report.hazard_type || report.type || 'line_break'));
        const severityHtml = renderSeverityStars(report.severity ?? report.severity_raw ?? 0);
        const priority = (report.priority_score !== undefined && report.priority_score !== null) ? Number(report.priority_score).toFixed(2) : 'N/A';
        const time = formatTimestamp(report.timestamp || report.created_at || new Date().toISOString());
        const description = escapeHtml(report.description || 'No description provided');

        let authenticityScore = report.authenticityScore || calculateAuthenticityScore(report);
        const authenticityBadge = getAuthenticityBadge(authenticityScore);
        
        const authenticityHtml = `
            <div class="row mt-3">
                <div class="col-12">
                    <h6>AI Authenticity Analysis ${backendConnected ? '<span class="badge bg-success ms-2">Live</span>' : '<span class="badge bg-warning ms-2">Fallback</span>'}</h6>
                    <div style="padding: 20px; background: var(--bg-tertiary); border-radius: 8px; border: 1px solid var(--border-color);">
                        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;">
                            <div>
                                <span style="font-size: 24px; font-weight: bold; color: ${authenticityScore >= 70 ? 'var(--success-color)' : 'var(--warning-color)'};">${authenticityScore}/100</span>
                                <div style="font-size: 12px; color: var(--text-muted); margin-top: 4px;">Authenticity Score</div>
                            </div>
                            ${authenticityBadge.html}
                        </div>
                        <div class="authenticity-progress" style="margin: 12px 0;">
                            <div class="authenticity-progress-fill score-${authenticityScore >= 80 ? 'excellent' : authenticityScore >= 60 ? 'good' : authenticityScore >= 40 ? 'warning' : 'danger'}" 
                                 style="width: ${authenticityScore}%;"></div>
                        </div>
                        <div class="authenticity-breakdown">
                            <div class="authenticity-metric">
                                <span class="authenticity-metric-label">Keyword Analysis:</span>
                                <span class="authenticity-metric-value">${getKeywordAnalysisDetails(report)}</span>
                            </div>
                            <div class="authenticity-metric">
                                <span class="authenticity-metric-label">Location Check:</span>
                                <span class="authenticity-metric-value">${getLocationCompatibilityDetails(report)}</span>
                            </div>
                            <div class="authenticity-metric">
                                <span class="authenticity-metric-label">Similar Reports:</span>
                                <span class="authenticity-metric-value">${getSimilarReportsDetails(report)}</span>
                            </div>
                            <div class="authenticity-metric">
                                <span class="authenticity-metric-label">Analysis Source:</span>
                                <span class="authenticity-metric-value">${backendConnected ? 'AI Backend' : 'Fallback System'}</span>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        `;

        let mediaHtml = '';
        if (Array.isArray(report.media_urls) && report.media_urls.length > 0) {
            mediaHtml = `<div class="d-flex flex-wrap">` +
                report.media_urls.map(url => {
                    const u = escapeHtml(url);
                    return `<a href="${u}" target="_blank" rel="noopener noreferrer"><img src="${u}" class="img-thumbnail m-1" style="max-width:200px; max-height:160px; object-fit:cover;"></a>`;
                }).join('') + `</div>`;
        }

        let weatherHtml = '';
        if (report.weather_conditions) {
            try { 
                weatherHtml = `<pre style="background: var(--bg-tertiary); color: var(--text-primary); padding:10px; border-radius:6px; max-height:240px; overflow:auto;">${escapeHtml(JSON.stringify(report.weather_conditions, null, 2))}</pre>`; 
            } catch (e) { 
                weatherHtml = `<div class="text-muted">Unable to render weather data</div>`; 
            }
        }

        const status = report.verification_status || report.status || 'pending';
        const isPending = String(status).toLowerCase() === 'pending';

        const existing = document.getElementById('reportDetailModal');
        if (existing) existing.remove();

        const modalHtml = `
            <div class="modal fade" id="reportDetailModal" tabindex="-1" aria-hidden="true">
              <div class="modal-dialog modal-lg modal-dialog-centered modal-dialog-scrollable">
                <div class="modal-content" style="background: var(--bg-secondary); border: 1px solid var(--border-color);">
                  <div class="modal-header" style="border-bottom: 1px solid var(--border-color);">
                    <h5 class="modal-title" style="color: var(--text-primary);">Report Analysis - ${escapeHtml(rid)}</h5>
                    <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close" style="filter: invert(1);"></button>
                  </div>
                  <div class="modal-body" style="color: var(--text-primary);">
                    <div class="row">
                      <div class="col-md-6">
                        <h6>Location</h6>
                        <p><strong>Coordinates:</strong> ${coords}</p>
                        <p><strong>Location Name:</strong> ${locationName}</p>
                      </div>
                      <div class="col-md-6">
                        <h6>Line Break Details</h6>
                        <p><strong>Type:</strong> ${hazardType}</p>
                        <p><strong>Severity:</strong> ${severityHtml}</p>
                        <p><strong>Priority Score:</strong> ${escapeHtml(String(priority))}</p>
                        <p><strong>Reported:</strong> ${escapeHtml(time)}</p>
                        <p><strong>Status:</strong> ${escapeHtml(String(status))}</p>
                      </div>
                    </div>

                    <div class="row mt-3">
                      <div class="col-12">
                        <h6>Description</h6>
                        <p>${description}</p>
                      </div>
                    </div>

                    ${authenticityHtml}

                    ${report.media_urls && report.media_urls.length ? `
                      <div class="row mt-3"><div class="col-12"><h6>Media</h6>${mediaHtml}</div></div>` : ''}

                    ${report.weather_conditions ? `
                      <div class="row mt-3"><div class="col-12"><h6>Weather Conditions</h6>${weatherHtml}</div></div>` : ''}
                  </div>

                  <div class="modal-footer" style="border-top: 1px solid var(--border-color);">
                    <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Close</button>
                    ${isPending ? `<button type="button" id="verifyBtn" class="btn btn-success">Verify</button>
                                   <button type="button" id="rejectBtn" class="btn btn-danger">Reject</button>` : ''}
                    <button type="button" id="alertAuthoritiesBtn" class="btn btn-warning">
                        <i class="fas fa-exclamation-triangle"></i> Alert Control Room
                    </button>
                  </div>
                </div>
              </div>
            </div>
        `;

        document.body.insertAdjacentHTML('beforeend', modalHtml);

        const modalEl = document.getElementById('reportDetailModal');
        const bsModal = new bootstrap.Modal(modalEl);
        bsModal.show();

        modalEl.addEventListener('hidden.bs.modal', () => {
            try { modalEl.remove(); } catch (e) { /* ignore */ }
        });

        const alertAuthoritiesBtn = document.getElementById('alertAuthoritiesBtn');
        if (alertAuthoritiesBtn) {
            alertAuthoritiesBtn.addEventListener('click', () => {
                bsModal.hide();
                showCreateAlertModal(rid);
            });
        }

        if (isPending) {
            const verifyBtn = document.getElementById('verifyBtn');
            const rejectBtn = document.getElementById('rejectBtn');

            if (verifyBtn) {
                verifyBtn.addEventListener('click', async () => {
                    try {
                        verifyBtn.disabled = true;
                        verifyBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Verifying...';
                        await verifyReport(rid, 'verified');
                        bsModal.hide();
                    } catch (err) {
                        showNotification('Failed to verify report', 'danger');
                        verifyBtn.disabled = false;
                        verifyBtn.innerHTML = 'Verify';
                    }
                });
            }

            if (rejectBtn) {
                rejectBtn.addEventListener('click', async () => {
                    try {
                        rejectBtn.disabled = true;
                        rejectBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Rejecting...';
                        await verifyReport(rid, 'rejected');
                        bsModal.hide();
                    } catch (err) {
                        showNotification('Failed to reject report', 'danger');
                        rejectBtn.disabled = false;
                        rejectBtn.innerHTML = 'Reject';
                    }
                });
            }
        }
    }

    // Helper functions for authenticity analysis details
    function getKeywordAnalysisDetails(report) {
        const description = (report.description || '').toLowerCase();
        const hazardType = (report.hazard_type || report.type || '').toLowerCase();
        const keywords = AUTHENTICITY_CONFIG.hazardKeywords[hazardType] || [];
        const matches = keywords.filter(keyword => description.includes(keyword.toLowerCase()));
        return matches.length > 0 ? `${matches.length} relevant keywords found` : 'No specific keywords detected';
    }

    function getLocationCompatibilityDetails(report) {
        const location = (report.location_name || report.location || '').toLowerCase();
        const hazardType = (report.hazard_type || report.type || '').toLowerCase();
        const compatible = checkLocationCompatibility(location, hazardType);
        return compatible ? 'Hazard type compatible with location' : 'Hazard type may not be typical for this location';
    }

    function getSimilarReportsDetails(report) {
        const latitude = parseFloat(report.latitude) || 0;
        const longitude = parseFloat(report.longitude) || 0;
        let similarCount = 0;
        
        currentHazards.forEach(hazard => {
            if (hazard.id === report.id) return;
            const latDiff = Math.abs(parseFloat(hazard.lat) - latitude);
            const lngDiff = Math.abs(parseFloat(hazard.lng) - longitude);
            if (latDiff < 0.5 && lngDiff < 0.5) {
                if (hazard.type === report.hazard_type || hazard.type === report.type) {
                    similarCount++;
                }
            }
        });
        
        return similarCount > 0 ? `${similarCount} similar reports in area` : 'No similar reports nearby';
    }

    window.verifyReport = async function (reportId, status) {
        try {
            await apiCall(`/api/reports/${reportId}/verify`, {
                method: 'POST',
                body: { status: status, verifier_id: 'admin' }
            });
            showNotification(`Report ${status} successfully`, 'success');

            const modalEl = document.getElementById('reportDetailModal');
            if (modalEl) {
                const instance = bootstrap.Modal.getInstance(modalEl);
                if (instance) instance.hide();
                modalEl.remove();
            }
            await fetchRecentReports();
            await fetchDashboardStats();
            if (typeof window.refreshHazards === 'function') await window.refreshHazards();
        } catch (err) {
            console.error('verify error', err);
            showNotification('Failed to update report status', 'danger');
        }
    };

    /* ---------- tab switching ---------- */
    function setupTabSwitching() {
        const tabBtns = document.querySelectorAll('.tab-btn');
        const tabContents = document.querySelectorAll('.tab-content');

        tabBtns.forEach(btn => {
            btn.addEventListener('click', async () => {
                tabBtns.forEach(b => b.classList.remove('active'));
                tabContents.forEach(c => c.classList.remove('active'));

                btn.classList.add('active');

                const tabName = btn.getAttribute('data-tab');
                const tabContent = document.getElementById(tabName + 'Tab');
                if (tabContent) {
                    tabContent.classList.add('active');
                }

                if (tabName === 'alerts') {
                    await fetchAuthorityAlerts();
                } else if (tabName === 'reports') {
                    await fetchRecentReports();
                } else if (tabName === 'map') {
                    setTimeout(() => {
                        if (map) {
                            map.invalidateSize();
                            updateHeatmap();
                        }
                    }, 100);
                }
            });
        });
    }

    /* ---------- auto refresh / filters / init ---------- */
    function startAutoRefresh() {
        stopAutoRefresh();
        refreshInterval = setInterval(async () => {
            try {
                await Promise.all([fetchHazardData(), fetchDashboardStats(), fetchRecentReports()]);
                
                const activeTab = document.querySelector('.tab-btn.active');
                if (activeTab && activeTab.getAttribute('data-tab') === 'alerts') {
                    await fetchAuthorityAlerts();
                }
            } catch (err) {
                console.error('Auto refresh error', err);
            }
        }, REFRESH_INTERVAL);
    }

    function stopAutoRefresh() {
        if (refreshInterval) { clearInterval(refreshInterval); refreshInterval = null; }
    }

    function setupFilters() {
        const filterForm = document.getElementById('filterForm');
        if (!filterForm) return;
        filterForm.addEventListener('submit', async (e) => { e.preventDefault(); await applyFilters(); });
        const resetBtn = document.getElementById('resetFiltersBtn');
        if (resetBtn) resetBtn.addEventListener('click', async () => { filterForm.reset(); await resetFilters(); });
    }

    async function applyFilters() {
        const filterForm = document.getElementById('filterForm');
        if (!filterForm) return;
        const formData = new FormData(filterForm);
        const params = new URLSearchParams();
        
        ['locationFilter','hazardTypeFilter','startDate','endDate','minSeverity','verificationStatus'].forEach(k => {
            const v = formData.get(k);
            if (v) params.append(k.replace(/Filter$/,''), v);
        });
        
        try {
            const data = await apiCall(`/api/reports/filter?${params.toString()}`);
            const reports = (Array.isArray(data) ? data : (data.reports || []));
            
            currentHazards = reports.map(r => ({
                id: r.id, lat: r.latitude, lng: r.longitude, type: r.hazard_type || r.type,
                severityRaw: r.severity ?? r.severity_raw ?? 0,
                severity: getSeverityLevel(r.severity), title: r.location_name || r.location, description: r.description,
                timestamp: r.timestamp, status: r.verification_status,
                authenticityScore: r.authenticityScore || calculateAuthenticityScore(r),
                authenticityBadge: getAuthenticityBadge(r.authenticityScore || calculateAuthenticityScore(r))
            }));
            updateHeatmap();
            showNotification('Filters applied successfully', 'success');
        } catch (err) {
            console.error('applyFilters error', err);
            showNotification('Failed to apply filters', 'danger');
        }
    }

    async function resetFilters() {
        await fetchHazardData();
        showNotification('Filters reset', 'success');
    }

    /* ---------- event listeners setup ---------- */
    function setupEventListeners() {
        const authorityAlertForm = document.getElementById('authorityAlertForm');
        if (authorityAlertForm) {
            authorityAlertForm.addEventListener('submit', async (e) => {
                e.preventDefault();
                const submitBtn = e.target.querySelector('button[type="submit"]');
                const originalBtnText = submitBtn.innerHTML;

                try {
                    submitBtn.disabled = true;
                    submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Sending Alert...';

                    const formData = new FormData(authorityAlertForm);
                    const alertData = {
                        report_id: formData.get('report_id'),
                        authority_type: formData.get('authority_type'),
                        message: formData.get('message'),
                        status: formData.get('status')
                    };

                    await submitAuthorityAlert(alertData);
                    
                    const modal = bootstrap.Modal.getInstance(document.getElementById('authorityAlertModal'));
                    if (modal) modal.hide();
                    authorityAlertForm.reset();
                    
                } catch (err) {
                    console.error('Authority alert submission error:', err);
                    showNotification(`Failed to send alert: ${err.message}`, 'danger');
                } finally {
                    submitBtn.disabled = false;
                    submitBtn.innerHTML = originalBtnText;
                }
            });
        }

        const createAlertBtn = document.getElementById('createAlertBtn');
        if (createAlertBtn) {
            createAlertBtn.addEventListener('click', () => showCreateAlertModal());
        }

        const refreshBtn = document.getElementById('refreshBtn');
        if (refreshBtn) {
            refreshBtn.addEventListener('click', async () => {
                refreshBtn.disabled = true;
                refreshBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Refreshing...';
                try {
                    await checkBackendConnection();
                    await Promise.all([
                        fetchHazardData(), 
                        fetchDashboardStats(), 
                        fetchRecentReports()
                    ]);
                    
                    const activeTab = document.querySelector('.tab-btn.active');
                    if (activeTab && activeTab.getAttribute('data-tab') === 'alerts') {
                        await fetchAuthorityAlerts();
                    }
                    
                    showNotification('Dashboard refreshed', 'success');
                } catch (err) {
                    showNotification('Refresh failed', 'danger');
                } finally {
                    refreshBtn.disabled = false;
                    refreshBtn.innerHTML = '<i class="fas fa-sync-alt"></i> Refresh Data';
                }
            });
        }
    }

    async function initializeDashboard() {
        try {
            initializeMap();
            setupFilters();
            setupTabSwitching();
            setupEventListeners();
            window.refreshHazards = fetchHazardData;

            await Promise.all([fetchHazardData(), fetchDashboardStats(), fetchRecentReports()]);

            startAutoRefresh();
            window.addEventListener('beforeunload', stopAutoRefresh);
            console.log('EPOCH Dashboard with AI Detection System initialized');
        } catch (err) {
            console.error('initializeDashboard error', err);
            showNotification('Dashboard initialization failed. Some features may not work.', 'warning');
        }
    }

    window.showCreateAlertModal = showCreateAlertModal;
    
    initializeDashboard();
});