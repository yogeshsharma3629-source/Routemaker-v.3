// sw.js
const CACHE_NAME = 'delivery-map-tiles-v1';

self.addEventListener('fetch', (event) => {
    // Only cache map tile requests
    if (event.request.url.includes('tile.openstreetmap.org')) {
        event.respondWith(
            caches.open(CACHE_NAME).then((cache) => {
                return cache.match(event.request).then((response) => {
                    return response || fetch(event.request).then((networkResponse) => {
                        cache.put(event.request, networkResponse.clone());
                        return networkResponse;
                    });
                });
            })
        );
    }
});