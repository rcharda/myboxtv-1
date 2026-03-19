importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging-compat.js');

firebase.initializeApp({
    apiKey:            "AIzaSyCfVPeXlkykjonVRLpQONlsw5wbp1ELz_k",
    authDomain:        "my-box-smart.firebaseapp.com",
    projectId:         "my-box-smart",
    storageBucket:     "my-box-smart.firebasestorage.app",
    messagingSenderId: "350859123838",
    appId:             "1:350859123838:web:b32a4b5b8293a685424c2f"
});

const messaging = firebase.messaging();

messaging.onBackgroundMessage((payload) => {
    const title = (payload.notification && payload.notification.title) || 'My Box Smart';
    const body  = (payload.notification && payload.notification.body)  || '';
    const data  = payload.data || {};
    self.registration.showNotification(title, {
        body,
        icon:    'https://upload.wikimedia.org/wikipedia/commons/b/bf/My_Box_Smart.png',
        badge:   'https://upload.wikimedia.org/wikipedia/commons/b/bf/My_Box_Smart.png',
        vibrate: [200, 100, 200],
        tag:     'myboxsmart-notif',
        renotify: true,
        requireInteraction: data.type === 'match',
        data,
        actions: data.channel ? [
            { action: 'watch', title: '📺 Regarder' },
            { action: 'close', title: '✕ Fermer' }
        ] : [
            { action: 'open', title: '📱 Ouvrir' }
        ]
    });
});

self.addEventListener('notificationclick', (event) => {
    event.notification.close();
    if (event.action === 'close') return;
    event.waitUntil(
        clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
            for (const client of list) {
                if ('focus' in client) {
                    client.focus();
                    client.postMessage({ type: 'FCM_CLICK', payload: event.notification.data });
                    return;
                }
            }
            if (clients.openWindow) return clients.openWindow('/');
        })
    );
});
