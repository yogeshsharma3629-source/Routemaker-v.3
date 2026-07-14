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

// DOM Elements
const statusBar = document.getElementById('statusBar');
const searchInput = document.getElementById('searchInput');
const searchButton = document.getElementById('searchButton');
const scanButton = document.getElementById('scanButton');
const fileInput = document.getElementById('fileInput');
const locateButton = document.getElementById('locateButton');
const mapViewBtn = document.getElementById('mapViewBtn');
const satelliteViewBtn = document.getElementById('satelliteViewBtn');

const addressSidebar = document.getElementById('addressSidebar');
const addressListContainer = document.getElementById('addressListContainer');
const closeSidebarBtn = document.getElementById('closeSidebarBtn');
const openSidebarBtn = document.getElementById('openSidebarBtn');
const clearAddressesBtn = document.getElementById('clearAddressesBtn');
const startRouteBtn = document.getElementById('startRouteBtn'); 

// NEW: API Key interactive prompt control
const apiKeyBtn = document.getElementById('apiKeyBtn');

if (apiKeyBtn) {
    apiKeyBtn.addEventListener('click', () => {
        const currentKey = GEMINI_API_KEY || "";
        const userKey = prompt("Please enter or paste your Gemini API Key:", currentKey);
        
        // If the user clicked 'Cancel', do nothing
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
    }
});

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
        toggleSidebar(false); 
        calculateOptimizedTrip();
    } else {
        startRouteBtn.textContent = 'Start Route';
        startRouteBtn.classList.remove('nav-active');
        clearRouteLine();
        statusBar.textContent = 'Navigation paused.';
    }
});

async function convertFileToBase64(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = () => resolve(reader.result.split(',')[1]);
        reader.onerror = error => reject(error);
    });
}
.gmaps-top-search {
    display: flex;
    align-items: center;
    background: #fff;
    border-radius: 24px;
    box-shadow: 0 2px 6px rgba(0,0,0,0.3);
    padding: 4px 8px; /* Gives nice breathing room for the icons */
    /* ... keep your existing positioning properties ... */
}

.gmaps-search-input {
    flex: 1;
    border: none;
    outline: none;
    padding: 8px;
    /* ... keep your existing styling ... */
}

.search-icon-btn {
    background: none;
    border: none;
    cursor: pointer;
    font-size: 18px;
    padding: 8px;
    display: flex;
    align-items: center;
    justify-content: center;
}



async function processExtractedStops(stops) {
    clearAllRouteData();
    toggleSidebar(true);
    statusBar.textContent = 'Locating stop coordinates...';

    routeStops = [];
    for (let i = 0; i < stops.length; i++) {
        const stop = stops[i];

        const cleanCity = stop.city ? stop.city.split('-')[0].trim() : "";
        const cleanPostalCode = stop.postal_code ? stop.postal_code.replace('A-', '').trim() : "";

        const searchString = `${stop.street}${cleanPostalCode ? ', ' + cleanPostalCode : ''}${cleanCity ? ' ' + cleanCity : ''}`;
        const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&q=${encodeURIComponent(searchString)}&countrycodes=at`;

        try {
            const res = await fetch(url);
            const data = await res.json();
            if (data && data.length > 0) {
                routeStops.push({
                    id: i,
                    street: stop.street,
                    city: `${stop.postal_code || ''} ${stop.city || ''}`.trim(),
                    lng: parseFloat(data[0].lon),
                    lat: parseFloat(data[0].lat)
                });
            } else {
                console.warn('Nominatim missed match on fallback lookups:', searchString);
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
        addressListContainer.innerHTML = '<p class="empty-state-text">No scanned addresses yet.</p>';
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
        `;
        item.addEventListener('click', () => {
            followUserMode = false;
            document.querySelectorAll('.address-item').forEach(el => el.classList.remove('active-stop'));
            item.classList.add('active-stop');
            map.flyTo({ center: [stop.lng, stop.lat], zoom: 16 });
        });
        addressListContainer.appendChild(item);
    });
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

function calculateOptimizedTrip() {
    if (routeStops.length === 0 || !navigationStarted) return;
    ensureRouteLayerExists();

    let startCoord = currentLocation
        ? `${currentLocation.longitude},${currentLocation.latitude}`
        : `${map.getCenter().lng},${map.getCenter().lat}`;

    const stopsCoords = routeStops.map(s => `${s.lng},${s.lat}`).join(';');
    const coordinatesString = `${startCoord};${stopsCoords}`;

    const url = `https://router.project-osrm.org/trip/v1/driving/${coordinatesString}?geometries=geojson&overview=full&source=first&destination=any`;

    fetch(url)
        .then(res => {
            if (!res.ok) throw new Error(`OSRM Status Error: ${res.status}`);
            return res.json();
        })
        .then(data => {
            if (!data.trips || !data.trips[0] || !navigationStarted) return;

            const routeSource = map.getSource('route');
            if (routeSource) {
                routeSource.setData({ 
                    type: 'FeatureCollection', 
                    features: [{ type: 'Feature', geometry: data.trips[0].geometry, properties: {} }] 
                });
                statusBar.textContent = 'Shortest delivery sequence calculated.';
            }

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
        })
        .catch((err) => { 
            console.error("OSRM Processing Exception:", err);
            statusBar.textContent = 'Routing sequence update failed.'; 
        });
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
    navigationStarted = false;
    startRouteBtn.textContent = 'Start Route';
    startRouteBtn.classList.remove('nav-active');
    activeMapMarkers.forEach(m => m.remove());
    activeMapMarkers = [];
    clearRouteLine();
    addressListContainer.innerHTML = '<p class="empty-state-text">No scanned addresses yet.</p>';
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

scanButton.addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', (e) => e.target.files[0] && scanImageWithGemini(e.target.files[0]));

locateButton.addEventListener('click', () => {
    if (currentLocation) {
        followUserMode = true;
        isUserInteracting = false;
        map.flyTo({ center: [currentLocation.longitude, currentLocation.latitude], zoom: 16 });
    } else {
        statusBar.textContent = 'Waiting for GPS signal...';
    }
});

mapViewBtn.addEventListener('click', () => setBaseLayer('street'));
satelliteViewBtn.addEventListener('click', () => setBaseLayer('satellite'));

searchButton.addEventListener('click', () => {
    const val = searchInput.value;
    if (!val) return;
    processExtractedStops([{ street: val, postal_code: "", city: "" }]);
});

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
