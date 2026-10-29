const CACHE_NAME = "cockpit-takeover-shell-v9";
const SHELL = ["./", "./index.html", "./cockpit.js", "./cockpit.css", "./manifest.webmanifest", "./icon.svg"];

self.addEventListener("install", function (event) {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(function (cache) { return cache.addAll(SHELL); })
      .then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener("activate", function (event) {
  event.waitUntil(
    caches.keys()
      .then(function (keys) {
        return Promise.all(keys.filter(function (key) {
          return /^(qg-cockpit-shell-|cockpit-takeover-shell-)/.test(key) && key !== CACHE_NAME;
        }).map(function (key) { return caches.delete(key); }));
      })
      .then(function () { return self.clients.claim(); })
  );
});

self.addEventListener("fetch", function (event) {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Always check the network first so a published update is visible immediately.
  event.respondWith(
    fetch(request).then(function (response) {
      if (response.ok && response.type === "basic") {
        return caches.open(CACHE_NAME).then(function (cache) {
          return cache.put(request, response.clone()).then(function () { return response; });
        });
      }
      return response;
    }).catch(function () {
      return caches.match(request).then(function (cached) {
        if (cached) return cached;
        if (request.mode === "navigate") return caches.match("./index.html");
        return Response.error();
      });
    })
  );
});
