// =====================================================================
// PASTE YOUR GEMINI API KEY INSIDE THE QUOTES BELOW
// =====================================================================
const GEMINI_API_KEY = "AQ.Ab8RN6KHeN6n7XZzUMwg9ym3PtLXvIbxvMD5zw2e_ig802WniA";

const map = new maplibregl.Map({
    container: 'map',
    style: {
        version: 8,
        sources: {
            osm: { type: 'raster', tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'], tileSize: 256, attribution: '&copy; OpenStreetMap contributors' },
            satellite: { type: 'raster', tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'], tileSize: 256, attribution: 'Tiles © Esri' }
        },
        layers: [
            { id: 'osm-layer', type: 'raster', source: 'osm', minzoom: 0, maxzoom: 19 },
            { id: 'satellite-layer', type: 'raster', source: 'satellite', minzoom: 0, maxzoom: 19, layout: { visibility: 'none' } }
        ]
    },
    center: [14.305, 48.306],
    zoom: 14
});

map.addControl(new maplibregl.NavigationControl(), 'top-right');

let userMarker = null;
let currentLocation = null;
let lastCalculatedCoords = null;
let routeStops = [];
let activeMapMarkers = [];

// App State Toggles
let isUserInteracting = false;
let followUserMode = true;
let navigationStarted = false; // NEW: Tracks if routing is started

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
const startRouteBtn = document.getElementById('startRouteBtn'); // NEW

map.on('movestart', (e) => {
    if (e.originalEvent) {
        isUserInteracting = true;
        followUserMode = false;
    }
});
// =====================================================================
// MOBILE SWIPE / SLIDER GESTURE LOGIC
// =====================================================================
let touchStartX = 0;
let touchEndX = 0;

// Track where the thumb first touches the screen
addressSidebar.addEventListener('touchstart', (e) => {
    touchStartX = e.changedTouches[0].screenX;
}, { passive: true });

// Track where the thumb lifts off the screen
addressSidebar.addEventListener('touchend', (e) => {
    touchEndX = e.changedTouches[0].screenX;
    handleSwipeGesture();
}, { passive: true });

// Also allow swiping open from the left edge tab button area
openSidebarBtn.addEventListener('touchstart', (e) => {
    touchStartX = e.changedTouches[0].screenX;
}, { passive: true });

openSidebarBtn.addEventListener('touchend', (e) => {
    touchEndX = e.changedTouches[0].screenX;
    handleSwipeGesture();
}, { passive: true });

function handleSwipeGesture() {
    const swipeDistance = touchEndX - touchStartX;
    
    // Swipe Left (Min 50px) -> Close the panel
    if (swipeDistance < -50 && addressSidebar.classList.contains('open')) {
        toggleSidebar(false);
    }
    
    // Swipe Right (Min 50px) -> Open the panel
    if (swipeDistance > 50 && !addressSidebar.classList.contains('open')) {
        toggleSidebar(true);
    }
}
function toggleSidebar(shouldOpen) {
    if (shouldOpen) {
        addressSidebar.classList.add('open');
        openSidebarBtn.style.display = 'none';
    } else {
        addressSidebar.classList.remove('open');
        openSidebarBtn.style.display = 'flex';
    }
}
closeSidebarBtn.addEventListener('click', () => toggleSidebar(false));
openSidebarBtn.addEventListener('click', () => toggleSidebar(true));

// NEW: Start/Stop Route Navigation Event Handler
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
        toggleSidebar(false); // Close slider panel to reveal full driving map view
        calculateOptimizedTrip();
    } else {
        startRouteBtn.textContent = 'Start Route';
        startRouteBtn.classList.remove('nav-active');
        // Clear route layout geometry line immediately
        if (map.getSource('route')) {
            map.getSource('route').setData({ type: 'FeatureCollection', features: [] });
        }
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

async function scanImageWithGemini(file) {
    statusBar.textContent = 'Uploading to Gemini AI...';
    try {
        const base64Data = await convertFileToBase64(file);
        const payload = {
            contents: [{
                parts: [
                    { text: 'Extract all delivery addresses from this image. DO NOT include client names. Return the data ONLY as a clean, standardized JSON array of objects with keys: "street", "postal_code", "city". No markdown format wrapper.' },
                    { inlineData: { mimeType: file.type, data: base64Data } }
                ]
            }]
        };

        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        const result = await response.json();
        if (!response.ok) throw new Error(result.error?.message || 'API request failed');

        const jsonText = result.candidates[0].content.parts[0].text.replace(/```json|```/g, '').trim();
        const extractedStops = JSON.parse(jsonText);

        if (Array.isArray(extractedStops) && extractedStops.length > 0) {
            statusBar.textContent = `Processed ${extractedStops.length} stops. Click 'Start Route' to navigate.`;
            processExtractedStops(extractedStops);
        } else {
            statusBar.textContent = 'No addresses detected.';
        }
    } catch (e) {
        console.error(e);
        statusBar.textContent = 'Error scanning image.';
    }
}

async function processExtractedStops(stops) {
    clearAllRouteData();
    toggleSidebar(true);
    statusBar.textContent = 'Locating stop coordinates...';

    routeStops = [];
    for (let i = 0; i < stops.length; i++) {
        const stop = stops[i];

        // NEW: Clean the city name by removing hyphens and sub-districts (e.g., "Leonding-Bergham" becomes "Leonding")
        const cleanCity = stop.city.split('-')[0].trim();

        // Clean the postal code if it contains an "A-" prefix
        const cleanPostalCode = stop.postal_code.replace('A-', '').trim();

        // Build the optimized search string for Nominatim
        const searchString = `${stop.street}, ${cleanPostalCode} ${cleanCity}`;
        const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&q=${encodeURIComponent(searchString)}&countrycodes=at`;

        try {
            const res = await fetch(url);
            const data = await res.json();
            if (data && data.length > 0) {
                routeStops.push({
                    id: i,
                    street: stop.street,
                    city: `${stop.postal_code} ${stop.city}`, // Keeps original display text for your sidebar list
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
function calculateOptimizedTrip() {
    // MODIFIED: Exit early if navigation mode toggle hasn't been engaged
    if (routeStops.length === 0 || !navigationStarted) return;

    let startCoord = currentLocation
        ? `${currentLocation.longitude},${currentLocation.latitude}`
        : `${map.getCenter().lng},${map.getCenter().lat}`;

    const stopsCoords = routeStops.map(s => `${s.lng},${s.lat}`).join(';');
    const coordinatesString = `${startCoord};${stopsCoords}`;

    // NEW: Allow a 25-meter snap radius for your moving car, and default 'any' for the delivery stops
    const radiusArray = ['25', ...routeStops.map(() => 'any')].join(';');

    // Added &radiuses= parameter to prevent the route from breaking during minor GPS jitter
    const url = `https://router.project-osrm.org/trip/v1/driving/${coordinatesString}?geometries=geojson&overview=full&source=first&destination=any&radiuses=${radiusArray}`;

    if (!map.getSource('route')) {
        map.addSource('route', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
        map.addLayer({ id: 'route-line', type: 'line', source: 'route', layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': '#1a73e8', 'line-width': 5 } });
    }

    fetch(url)
        .then(res => res.json())
        .then(data => {
            if (!data.trips || !data.trips[0] || !navigationStarted) return;

            map.getSource('route').setData({ type: 'FeatureCollection', features: [{ type: 'Feature', geometry: data.trips[0].geometry, properties: {} }] });
            statusBar.textContent = 'Shortest delivery sequence calculated.';

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
        .catch(() => { statusBar.textContent = 'Routing calculation timeout.'; });
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
    if (map.getSource('route')) {
        map.getSource('route').setData({ type: 'FeatureCollection', features: [] });
    }
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
    mapViewBtn.classList.toggle('active', layer === 'street');
    satelliteViewBtn.classList.toggle('active', layer === 'satellite');
}

map.on('load', () => setBaseLayer('street'));
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
            const dist = calculateDistance(latitude, longitude, lastCalculatedCoords?.lat, lastCalculatedCoords?.lon);
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
