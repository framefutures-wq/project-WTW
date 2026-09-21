self.addEventListener("push", (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = {}; }
  const title = typeof data.title === "string" ? data.title : "주말뭐해?";
  const body = typeof data.body === "string" ? data.body : "새로운 행사 소식이 있어요.";
  const tag = typeof data.tag === "string" ? data.tag : "wtw:notice";
  const url = typeof data.url === "string" && data.url.startsWith("/?event=") ? data.url : "/";
  event.waitUntil(self.registration.showNotification(title, { body, tag, data: { url }, renotify: false }));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = new URL(event.notification.data?.url || "/", self.location.origin).href;
  event.waitUntil(clients.matchAll({ type: "window", includeUncontrolled: true }).then((windows) => {
    const existing = windows.find((client) => client.url.startsWith(self.location.origin));
    return existing ? existing.focus().then(() => existing.navigate(url)) : clients.openWindow(url);
  }));
});
