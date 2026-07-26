// =====================================================================
// INLINE SIDEBAR KEY MANAGEMENT
// =====================================================================
let GEMINI_API_KEY = "";

// Read key on initialization if it already exists locally
try {
    GEMINI_API_KEY = localStorage.getItem('GEMINI_API_KEY') || "";
} catch (e) {
    console.warn("Local storage access blocked:", e);
}

const map = new maplibregl.Map({
    container: 'map',
    style: {
        version: 8,
        sources: {
            'osm': {
                type: 'raster',
                tiles: [
                    'https://a.tile.openstreetmap.org/{z}/{x}/{y}.png',
                    'https://b.tile.openstreetmap.org/{z}/{x}/{y}.png',
                    'https://c.tile.openstreetmap.org/{z}/{x}/{y}.png'
                ],
                tileSize: 256,
                attribution: '&copy; OpenStreetMap contributors'
            },
            'satellite': {
                type: 'raster',
                tiles: [
                    'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'
                ],
                tileSize: 256,
                attribution: 'Tiles &copy; Esri'
            }
        },
        layers: [
            {
                id: 'osm-layer',
                type: 'raster',
                source: 'osm',
                minzoom: 0,
                maxzoom: 19,
                layout: { visibility: 'visible' }
            },
            {
                id: 'satellite-layer',
                type: 'raster',
                source: 'satellite',
                minzoom: 0,
                maxzoom: 19,
                layout: { visibility: 'none' }
            }
        ]
    },
    center: [14.305, 48.306],
    zoom: 14
});

map.addControl(new maplibregl.NavigationControl(), 'top-right');

// MapLibre Internal Error Logger
map.on('error', (e) => {
    alert("MapLibre Internal Error:\n" + (e.error ? e.error.message : JSON.stringify(e)));
});

let userMarker = null;
let currentLocation = null;
let lastCalculatedCoords = null;
let routeStops = [];
let activeMapMarkers = [];

// App State Toggles
let isUserInteracting = false;
let followUserMode = true;
let navigationStarted = false; 

// DOM Elements
const statusBar = document.getElementById('statusBar');
const searchInput = document.getElementById('searchInput');
const searchButton = document.getElementById('searchButton');
const scanButton = document.getElementById('scanButton');
const fileInput = document.getElementById('fileInput');
const locateButton = document.getElementById('locateButton');
const recenterBtn = document.getElementById('recenterBtn');
const mapViewBtn = document.getElementById('mapViewBtn');
const satelliteViewBtn = document.getElementById('satelliteViewBtn');

const addressSidebar = document.getElementById('addressSidebar');
const addressListContainer = document.getElementById('addressListContainer');
const closeSidebarBtn = document.getElementById('closeSidebarBtn');
const openSidebarBtn = document.getElementById('openSidebarBtn');
const clearAddressesBtn = document.getElementById('clearAddressesBtn');
const startRouteBtn = document.getElementById('startRouteBtn'); 

// New Manual Add & Scan Elements
const manualAddressInput = document.getElementById('manualAddressInput');
const addManualBtn = document.getElementById('addManualBtn');
const scanMoreBtn = document.getElementById('scanMoreBtn');

// Navigation HUD Elements
const navHud = document.getElementById('navHud');
const navManeuverIcon = document.getElementById('navManeuverIcon');
const navInstruction = document.getElementById('navInstruction');
const navSubText = document.getElementById('navSubText');
const exitNavBtn = document.getElementById('exitNavBtn');

// Route Banner Stats Elements
const routeBanner = document.getElementById('routeBanner');
const routeTime = document.getElementById('routeTime');
const routeDistance = document.getElementById('routeDistance');
const recalculateBtn = document.getElementById('recalculateBtn');

// API Key interactive prompt control
const apiKeyBtn = document.getElementById('apiKeyBtn');

if (apiKeyBtn) {
    apiKeyBtn.addEventListener('click', () => {
        const currentKey = GEMINI_API_KEY || "";
        const userKey = prompt("Please enter or paste your Gemini API Key:", currentKey);
        
        if (userKey === null) return;
        
        const freshKey = userKey.trim();
        if (freshKey) {
            GEMINI_API_KEY = freshKey;
            try {
                localStorage.setItem('GEMINI_API_KEY', freshKey);
                statusBar.textContent = "API Key saved successfully!";
            } catch(e) {
                statusBar.textContent = "Saved for this session (Storage blocked).";
            }
        } else {
            GEMINI_API_KEY = "";
            try { localStorage.removeItem('GEMINI_API_KEY'); } catch(e) {}
            statusBar.textContent = "API Key removed.";
        }
    });
}

map.on('movestart', (e) => {
    if (e.originalEvent) {
        isUserInteracting = true;
        followUserMode = false;
        if (recenterBtn) recenterBtn.style.display = 'flex';
    }
});

if (recenterBtn) {
    recenterBtn.addEventListener('click', () => {
        if (currentLocation) {
            followUserMode = true;
            isUserInteracting = false;
            recenterBtn.style.display = 'none';
            map.flyTo({ center: [currentLocation.longitude, currentLocation.latitude], zoom: 16 });
        }
    });
}

// =====================================================================
// MOBILE SLIDER STATE LOGIC
// =====================================================================
function toggleSidebar(shouldOpen) {
    if (shouldOpen) {
        addressSidebar.classList.add('open');
        if (openSidebarBtn) openSidebarBtn.style.display = 'none';
    } else {
        addressSidebar.classList.remove('open');
        if (openSidebarBtn) openSidebarBtn.style.display = 'flex';
    }
}

if (closeSidebarBtn) closeSidebarBtn.addEventListener('click', () => toggleSidebar(false));
if (openSidebarBtn) openSidebarBtn.addEventListener('click', () => toggleSidebar(true));

// Start/Stop Route Navigation Event Handler
startRouteBtn.addEventListener('click', () => {
    if (routeStops.length === 0) {
        statusBar.textContent = 'Please scan or search addresses first.';
        return;
    }

    navigationStarted = !navigationStarted;

    if (navigationStarted) {
        startRouteBtn.textContent = 'Stop Navigation';
        startRouteBtn.classList.add('nav-active');
        followUserMode = true;
        isUserInteracting = false;
        if (recenterBtn) recenterBtn.style.display = 'none';
        toggleSidebar(false); 
        if (navHud) navHud.style.display = 'flex';
        calculateOptimizedTrip();
    } else {
        stopNavigationUI();
    }
});

if (exitNavBtn) {
    exitNavBtn.addEventListener('click', () => {
        stopNavigationUI();
    });
}

function stopNavigationUI() {
    navigationStarted = false;
    startRouteBtn.textContent = 'Start Navigation';
    startRouteBtn.classList.remove('nav-active');
    if (navHud) navHud.style.display = 'none';
    if (routeBanner) routeBanner.style.display = 'none';
    clearRouteLine();
    statusBar.textContent = 'Navigation paused.';
}

async function convertFileToBase64(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = () => resolve(reader.result.split(',')[1]);
        reader.onerror = error => reject(error);
    });
}

// =====================================================================
// MULTI-FILE & PDF GEMINI SCANNING LOGIC
// =====================================================================
async function scanSingleFileWithGemini(file) {
    if (!GEMINI_API_KEY) {
        statusBar.textContent = 'Error: Please set your Gemini API key by clicking the 🔑 button.';
        alert('Missing API Key! Please click the 🔑 button first.');
        return;
    }

    statusBar.textContent = `Scanning: ${file.name}...`;
    try {
        const base64Data = await convertFileToBase64(file);
        
        const mimeType = file.type || (file.name.endsWith('.pdf') ? 'application/pdf' : 'image/jpeg');

        const payload = {
            contents: [{
                parts: [
                    { inlineData: { mimeType: mimeType, data: base64Data } },
                    { text: 'Extract all delivery addresses from this document. Return data ONLY as a clean JSON array of objects with keys: "street", "postal_code", "city". No markdown format wrapper.' }
                ]
            }]
        };

        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        const result = await response.json();
        
        if (!response.ok) {
            alert(`API Error on file "${file.name}" (${response.status}): ${JSON.stringify(result.error || result)}`);
            statusBar.textContent = `API Error Status: ${response.status}`;
            return;
        }

        if (!result.candidates || !result.candidates[0]?.content?.parts?.[0]?.text) {
            alert(`Unexpected format: ${JSON.stringify(result)}`);
            statusBar.textContent = "Format error.";
            return;
        }

        let jsonText = result.candidates[0].content.parts[0].text;
        jsonText = jsonText.replace(/```json/g, '').replace(/```/g, '').trim();
        
        const extractedStops = JSON.parse(jsonText);

        if (Array.isArray(extractedStops) && extractedStops.length > 0) {
            statusBar.textContent = `Added data from ${file.name}.`;
            appendExtractedStops(extractedStops);
        } else {
            statusBar.textContent = `No addresses detected inside ${file.name}.`;
        }
    } catch (e) {
        alert(`System Catch Error on "${file.name}": ${e.message}`);
        statusBar.textContent = `Error: ${e.message}`;
    }
}

// =====================================================================
// GOOGLE MAPS LINK & ADDRESS PARSING
// =====================================================================
function parseInputString(inputStr) {
    const trimmed = inputStr.trim();
    
    // Check if input is a Google Maps URL containing coordinates
    if (trimmed.includes('google.com/maps') || trimmed.includes('goo.gl/maps') || trimmed.includes('maps.app.goo.gl')) {
        // Match @lat,lng pattern inside Google Maps URLs
        const coordMatch = trimmed.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/);
        if (coordMatch) {
            return { lat: parseFloat(coordMatch[1]), lng: parseFloat(coordMatch[2]), rawName: "Google Maps Pin" };
        }
        
        // Match q=lat,lng pattern
        const qMatch = trimmed.match(/q=(-?\d+\.\d+),(-?\d+\.\d+)/);
        if (qMatch) {
            return { lat: parseFloat(qMatch[1]), lng: parseFloat(qMatch[2]), rawName: "Google Maps Pin" };
        }
    }

    // Direct Lat, Lng input format (e.g., "48.306, 14.305")
    const directCoords = trimmed.match(/^(-?\d+\.\d+)\s*,\s*(-?\d+\.\d+)$/);
    if (directCoords) {
        return { lat: parseFloat(directCoords[1]), lng: parseFloat(directCoords[2]), rawName: "Dropped Pin" };
    }

    return { street: trimmed, postal_code: "", city: "" };
}

async function handleAddressOrLinkInput(inputVal) {
    if (!inputVal) return;
    
    const parsed = parseInputString(inputVal);
    
    if (parsed.lat && parsed.lng) {
        // Directly add coordinate stop
        routeStops.push({
            id: routeStops.length,
            street: parsed.rawName,
            city: `${parsed.lat.toFixed(4)}, ${parsed.lng.toFixed(4)}`,
            lng: parsed.lng,
            lat: parsed.lat
        });
        plotPinsAndFitMap(true);
        toggleSidebar(true);
    } else {
        // Pass through geocoding pipeline
        appendExtractedStops([parsed]);
    }
}

async function appendExtractedStops(stops) {
    toggleSidebar(true);
    statusBar.textContent = 'Locating stop coordinates...';

    for (let i = 0; i < stops.length; i++) {
        const stop = stops[i];

        if (stop.lat && stop.lng) {
            routeStops.push({
                id: routeStops.length,
                street: stop.street || "Custom Location",
                city: `${stop.lat.toFixed(4)}, ${stop.lng.toFixed(4)}`,
                lng: stop.lng,
                lat: stop.lat
            });
            continue;
        }

        const cleanCity = stop.city ? stop.city.split('-')[0].trim() : "";
        const cleanPostalCode = stop.postal_code ? stop.postal_code.replace('A-', '').trim() : "";

        const searchString = `${stop.street}${cleanPostalCode ? ', ' + cleanPostalCode : ''}${cleanCity ? ' ' + cleanCity : ''}`;
        const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&q=${encodeURIComponent(searchString)}`;

        try {
            const res = await fetch(url);
            const data = await res.json();
            if (data && data.length > 0) {
                routeStops.push({
                    id: routeStops.length,
                    street: stop.street,
                    city: `${stop.postal_code || ''} ${stop.city || data[0].display_name.split(',')[1] || ''}`.trim(),
                    lng: parseFloat(data[0].lon),
                    lat: parseFloat(data[0].lat)
                });
            } else {
                console.warn('Nominatim missed match on lookups:', searchString);
                statusBar.textContent = `Could not locate: ${stop.street}`;
            }
        } catch (err) {
            console.error('Failed to locate address: ' + searchString, err);
        }
    }

    plotPinsAndFitMap(true);
}

function plotPinsAndFitMap(forceInitialFit = false) {
    activeMapMarkers.forEach(m => m.remove());
    activeMapMarkers = [];

    if (routeStops.length === 0) return;

    routeStops.forEach((stop, index) => {
        const marker = new maplibregl.Marker({ element: createNumberedPin(index + 1) })
            .setLngLat([stop.lng, stop.lat])
            .setPopup(new maplibregl.Popup({ offset: 25 }).setHTML(`<b>Stop ${index + 1}</b><br>${stop.street}`))
            .addTo(map);

        activeMapMarkers.push(marker);
    });

    renderSidebarList();

    if (forceInitialFit) {
        const bounds = new maplibregl.LngLatBounds();
        routeStops.forEach(stop => bounds.extend([stop.lng, stop.lat]));
        if (currentLocation) bounds.extend([currentLocation.longitude, currentLocation.latitude]);
        map.fitBounds(bounds, { padding: 80, maxZoom: 15 });
    }

    if (navigationStarted) {
        calculateOptimizedTrip();
    }
}

function renderSidebarList() {
    addressListContainer.innerHTML = '';
    if (routeStops.length === 0) {
        addressListContainer.innerHTML = '<p class="empty-state-text">No scanned addresses yet. Click the upload button or scan documents to build your route.</p>';
        return;
    }

    routeStops.forEach((stop, index) => {
        const item = document.createElement('div');
        item.className = 'address-item';
        item.innerHTML = `
            <div class="stop-number">${index + 1}</div>
            <div class="address-text-block">
                <span class="address-street">${stop.street}</span>
                <span class="address-city">${stop.city}</span>
            </div>
            <button class="remove-stop-btn" title="Remove stop">&times;</button>
        `;

        item.querySelector('.remove-stop-btn').addEventListener('click', (e) => {
            e.stopPropagation();
            removeStop(index);
        });

        item.addEventListener('click', () => {
            followUserMode = false;
            if (recenterBtn) recenterBtn.style.display = 'flex';
            document.querySelectorAll('.address-item').forEach(el => el.classList.remove('active-stop'));
            item.classList.add('active-stop');
            map.flyTo({ center: [stop.lng, stop.lat], zoom: 16 });
        });
        addressListContainer.appendChild(item);
    });
}

function removeStop(index) {
    routeStops.splice(index, 1);
    plotPinsAndFitMap(false);
    if (navigationStarted) calculateOptimizedTrip();
}

function ensureRouteLayerExists() {
    if (!map.getSource('route')) {
        map.addSource('route', { 
            type: 'geojson', 
            data: { type: 'FeatureCollection', features: [] } 
        });
        map.addLayer({ 
            id: 'route-line', 
            type: 'line', 
            source: 'route', 
            layout: { 'line-join': 'round', 'line-cap': 'round' }, 
            paint: { 'line-color': '#1a73e8', 'line-width': 6 } 
        });
    }
}

function clearRouteLine() {
    if (map.getSource('route')) {
        map.getSource('route').setData({ type: 'FeatureCollection', features: [] });
    }
}

// =====================================================================
// TURN-BY-TURN HUD & OSRM TRIP ROUTING
// =====================================================================
function calculateOptimizedTrip() {
    if (routeStops.length === 0 || !navigationStarted) return;
    ensureRouteLayerExists();

    let startCoord = currentLocation
        ? `${currentLocation.longitude},${currentLocation.latitude}`
        : `${map.getCenter().lng},${map.getCenter().lat}`;

    const stopsCoords = routeStops.map(s => `${s.lng},${s.lat}`).join(';');
    const coordinatesString = `${startCoord};${stopsCoords}`;

    const url = `https://router.project-osrm.org/trip/v1/driving/${coordinatesString}?geometries=geojson&steps=true&overview=full&source=first&destination=any`;

    fetch(url)
        .then(res => {
            if (!res.ok) throw new Error(`OSRM Status Error: ${res.status}`);
            return res.json();
        })
        .then(data => {
            if (!data.trips || !data.trips[0] || !navigationStarted) return;

            const trip = data.trips[0];

            // Render Blue Route Line
            const routeSource = map.getSource('route');
            if (routeSource) {
                routeSource.setData({ 
                    type: 'FeatureCollection', 
                    features: [{ type: 'Feature', geometry: trip.geometry, properties: {} }] 
                });
            }

            // Update Stats Banner (ETA & Distance)
            const durationMin = Math.round(trip.duration / 60);
            const distKm = (trip.distance / 1000).toFixed(1);
            if (routeTime) routeTime.textContent = `${durationMin} min`;
            if (routeDistance) routeDistance.textContent = `(${distKm} km)`;
            if (routeBanner) routeBanner.style.display = 'flex';

            // Extract Turn-by-Turn Instruction for Top Navigation HUD
            if (trip.legs && trip.legs[0] && trip.legs[0].steps && trip.legs[0].steps.length > 0) {
                const currentStep = trip.legs[0].steps[0];
                const nextStep = trip.legs[0].steps[1];

                const maneuverType = currentStep.maneuver ? currentStep.maneuver.type : 'turn';
                const modifier = currentStep.maneuver ? currentStep.maneuver.modifier : '';
                
                if (navManeuverIcon) navManeuverIcon.textContent = getManeuverSymbol(maneuverType, modifier);
                if (navInstruction) navInstruction.textContent = currentStep.name ? `On ${currentStep.name}` : `Head towards Stop 1`;
                if (navSubText && nextStep) {
                    const stepDist = Math.round(nextStep.distance);
                    navSubText.textContent = `In ${stepDist}m, ${nextStep.maneuver.type} ${nextStep.maneuver.modifier || ''}`;
                }
            }

            // Re-order Stops Sequence
            if (data.waypoints) {
                const orderedWaypoints = data.waypoints
                    .sort((a, b) => a.waypoint_index - b.waypoint_index)
                    .filter(wp => wp.location_index > 0);

                const reorderedStops = orderedWaypoints.map(wp => routeStops[wp.location_index - 1]);
                if (reorderedStops.length === routeStops.length && !reorderedStops.includes(undefined)) {
                    routeStops = reorderedStops;
                    renderSidebarList();
                }
            }

            statusBar.textContent = 'Optimized route updated.';
        })
        .catch((err) => { 
            console.error("OSRM Processing Exception:", err);
            statusBar.textContent = 'Routing sequence update failed.'; 
        });
}

function getManeuverSymbol(type, modifier) {
    if (modifier.includes('left')) return '↰';
    if (modifier.includes('right')) return '↱';
    if (type.includes('fork')) return '⑂';
    if (type.includes('roundabout')) return '↻';
    return '⬆';
}

function updateLocationDot(coords) {
    const { latitude, longitude, heading } = coords;
    currentLocation = { latitude, longitude };

    if (!userMarker) {
        const el = document.createElement('div');
        el.className = 'user-dot-container';
        el.style.transition = 'transform 0.4s ease-out';
        el.innerHTML = `<div class="pulse-ring"></div><div class="blue-dot"></div><div class="compass-cone"></div>`;

        userMarker = new maplibregl.Marker({ element: el }).setLngLat([longitude, latitude]).addTo(map);
        statusBar.textContent = 'GPS location acquired.';
    } else {
        userMarker.setLngLat([longitude, latitude]);
    }

    const cone = userMarker.getElement().querySelector('.compass-cone');
    if (cone && heading !== null && heading !== undefined) {
        cone.style.display = 'block';
        cone.style.transform = `rotate(${heading}deg)`;
    } else if (cone) {
        cone.style.display = 'none';
    }

    if (followUserMode) {
        map.easeTo({
            center: [longitude, latitude],
            essential: true,
            duration: 600
        });
    }
}

function clearAllRouteData() {
    routeStops = [];
    stopNavigationUI();
    activeMapMarkers.forEach(m => m.remove());
    activeMapMarkers = [];
    clearRouteLine();
    addressListContainer.innerHTML = '<p class="empty-state-text">No scanned addresses yet. Click the upload button or scan documents to build your route.</p>';
}

clearAddressesBtn.addEventListener('click', clearAllRouteData);

function createNumberedPin(number) {
    const container = document.createElement('div');
    container.className = 'numbered-pin';
    container.innerHTML = `<span>${number}</span>`;
    return container;
}

function setBaseLayer(layer) {
    map.setLayoutProperty('osm-layer', 'visibility', layer === 'street' ? 'visible' : 'none');
    map.setLayoutProperty('satellite-layer', 'visibility', layer === 'satellite' ? 'visible' : 'none');
    
    if (layer === 'street') {
        mapViewBtn.classList.add('active');
        satelliteViewBtn.classList.remove('active');
    } else {
        satelliteViewBtn.classList.add('active');
        mapViewBtn.classList.remove('active');
    }
}

map.on('load', () => {
    setBaseLayer('street');
    ensureRouteLayerExists();
});

// File Upload Triggers
scanButton.addEventListener('click', () => fileInput.click());
if (scanMoreBtn) scanMoreBtn.addEventListener('click', () => fileInput.click());

fileInput.addEventListener('change', (e) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    statusBar.textContent = `Queued ${files.length} document(s) for scanning...`;
    
    Array.from(files).forEach((file) => {
        scanSingleFileWithGemini(file);
    });
});

// Manual Address & Google Maps Link Additions
if (addManualBtn && manualAddressInput) {
    addManualBtn.addEventListener('click', () => {
        const val = manualAddressInput.value;
        if (!val) return;
        handleAddressOrLinkInput(val);
        manualAddressInput.value = '';
    });

    manualAddressInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            const val = manualAddressInput.value;
            if (!val) return;
            handleAddressOrLinkInput(val);
            manualAddressInput.value = '';
        }
    });
}

searchButton.addEventListener('click', () => {
    const val = searchInput.value;
    if (!val) return;
    handleAddressOrLinkInput(val);
    searchInput.value = '';
});

searchInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
        const val = searchInput.value;
        if (!val) return;
        handleAddressOrLinkInput(val);
        searchInput.value = '';
    }
});

locateButton.addEventListener('click', () => {
    if (currentLocation) {
        followUserMode = true;
        isUserInteracting = false;
        if (recenterBtn) recenterBtn.style.display = 'none';
        map.flyTo({ center: [currentLocation.longitude, currentLocation.latitude], zoom: 16 });
    } else {
        statusBar.textContent = 'Waiting for GPS signal...';
    }
});

mapViewBtn.addEventListener('click', () => setBaseLayer('street'));
satelliteViewBtn.addEventListener('click', () => setBaseLayer('satellite'));

if (recalculateBtn) {
    recalculateBtn.addEventListener('click', () => {
        if (routeStops.length > 0) calculateOptimizedTrip();
    });
}

// GPS Tracking
if ('geolocation' in navigator) {
    navigator.geolocation.watchPosition((pos) => {
        const { latitude, longitude } = pos.coords;
        updateLocationDot(pos.coords);

        if (routeStops.length > 0 && navigationStarted) {
            const prevLat = lastCalculatedCoords ? lastCalculatedCoords.lat : null;
            const prevLon = lastCalculatedCoords ? lastCalculatedCoords.lon : null;
            const dist = calculateDistance(latitude, longitude, prevLat, prevLon);
            
            if (!lastCalculatedCoords || dist > 0.025) {
                lastCalculatedCoords = { lat: latitude, lon: longitude };
                calculateOptimizedTrip();
            }
        }
    }, (err) => {
        console.error("GPS error:", err);
        statusBar.textContent = 'GPS permission denied or unavailable.';
    }, { enableHighAccuracy: true, maximumAge: 0 });
}

function calculateDistance(lat1, lon1, lat2, lon2) {
    if (!lat2 || !lon2) return 999;
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
