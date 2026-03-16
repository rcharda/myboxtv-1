/**
 * ============================================================
 * MY BOX SMART — PLAYLIST M3U SÉCURISÉE + CONTRÔLE ÉCRANS
 * Cloudflare Pages Function : /functions/playlist.js
 *
 * À chaque téléchargement du M3U :
 *   1. Vérifie la clé et l'abonnement
 *   2. Génère un device_id unique pour cet appareil
 *   3. Vérifie si max_ecrans est atteint
 *   4. Enregistre le device_id dans Supabase
 *   5. Génère le M3U avec did= dans chaque URL
 *
 * Résultat : chaque M3U téléchargé appartient à 1 appareil
 * Si le client partage son lien → bloqué si max atteint
 * ============================================================
 */

const SUPABASE_URL = "https://yvcdadenofftnbljutwk.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inl2Y2RhZGVub2ZmdG5ibGp1dHdrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI4NzQ0ODIsImV4cCI6MjA4ODQ1MDQ4Mn0.xqJzLpQszFmph599FBIvdE7NF88_i-JkABG-aSrAndE";

function calcDaysLeft(user) {
    if (!user) return 0;
    if (user.duree === "VIE") return 9999;
    var total = parseInt(user.duree) || 0;
    if (total <= 0) return 0;
    if (!user.date_activation) return total;
    var act   = new Date(user.date_activation);
    var today = new Date();
    act.setHours(0,0,0,0);
    today.setHours(0,0,0,0);
    return Math.max(0, total - Math.floor((today - act) / 86400000));
}

function errResponse(msg, status, CORS) {
    return new Response(msg, {
        status: status,
        headers: Object.assign({}, CORS, { "Content-Type": "text/plain; charset=utf-8" })
    });
}

// Générer un device_id aléatoire unique
function generateDeviceId() {
    var arr = new Uint8Array(12);
    crypto.getRandomValues(arr);
    return Array.from(arr).map(b => b.toString(16).padStart(2,"0")).join("");
}

export async function onRequest(context) {
    var request = context.request;
    var reqUrl  = new URL(request.url);
    var params  = reqUrl.searchParams;
    var baseUrl = reqUrl.origin;

    var CORS = {
        "Access-Control-Allow-Origin":  "*",
        "Access-Control-Allow-Methods": "GET, OPTIONS",
    };

    if (request.method === "OPTIONS") {
        return new Response(null, { status: 204, headers: CORS });
    }

    var userKey  = (params.get("key")    || "").trim().toUpperCase();
    var category = (params.get("cat")    || "").trim().toLowerCase();
    var search   = (params.get("search") || "").trim().toLowerCase();
    var format   = (params.get("format") || "m3u").toLowerCase();
    // did existant = l'appareil retélécharge son propre M3U
    var existingDid = (params.get("did") || "").trim();

    var sbHeaders = {
        "apikey":        SUPABASE_KEY,
        "Authorization": "Bearer " + SUPABASE_KEY,
        "Content-Type":  "application/json",
    };

    // ── 1. Clé obligatoire ───────────────────────────────────
    if (!userKey) {
        return errResponse("Clé manquante. Utilisez /playlist?key=VOTRE-CLE", 400, CORS);
    }

    // ── 2. Vérification abonnement (BLOQUANTE) ───────────────
    var user = null;
    try {
        var authRes = await fetch(
            SUPABASE_URL + "/rest/v1/utilisateurs?cle=eq." +
            encodeURIComponent(userKey) +
            "&select=cle,duree,date_activation,max_ecrans,appareils_iptv&limit=1",
            { headers: sbHeaders }
        );

        if (!authRes.ok) return errResponse("Erreur serveur. Réessayez.", 503, CORS);

        var users = await authRes.json();
        if (!users || users.length === 0) {
            return errResponse("Clé invalide. Abonnez-vous sur myboxsmart.pages.dev", 403, CORS);
        }

        user = users[0];
        var daysLeft = calcDaysLeft(user);
        if (daysLeft <= 0 && user.duree !== "VIE") {
            return errResponse("Abonnement expiré. Renouvelez sur myboxsmart.pages.dev", 403, CORS);
        }

    } catch(e) {
        return errResponse("Erreur serveur temporaire. Réessayez.", 503, CORS);
    }

    // ── 3. Contrôle des écrans (Device ID) ───────────────────
    var maxScreens  = parseInt(user.max_ecrans) || 1;
    // appareils_iptv = liste des device_id enregistrés pour IPTV
    var appareilsRaw = user.appareils_iptv || "";
    var appareils   = appareilsRaw ? appareilsRaw.split(",").map(function(d){ return d.trim(); }).filter(Boolean) : [];

    var deviceId = "";

    if (existingDid && appareils.indexOf(existingDid) !== -1) {
        // ✅ Appareil déjà enregistré → il retélécharge son propre M3U
        deviceId = existingDid;

    } else if (appareils.length < maxScreens) {
        // ✅ Place disponible → nouvel appareil, générer un did
        deviceId = generateDeviceId();
        appareils.push(deviceId);

        // Enregistrer dans Supabase
        try {
            await fetch(
                SUPABASE_URL + "/rest/v1/utilisateurs?cle=eq." + encodeURIComponent(userKey),
                {
                    method:  "PATCH",
                    headers: Object.assign({}, sbHeaders, { "Prefer": "return=minimal" }),
                    body:    JSON.stringify({ appareils_iptv: appareils.join(",") })
                }
            );
        } catch(e) {
            // Non bloquant — on continue quand même
        }

    } else {
        // ❌ Max écrans atteint et appareil inconnu → BLOQUÉ
        return errResponse(
            "Limite d'appareils atteinte (" + maxScreens + " écran(s) max).\n" +
            "Contactez le support sur WhatsApp : 63 82 87 67",
            403, CORS
        );
    }

    // ── 4. Récupérer les chaînes depuis Supabase ─────────────
    var channels = [];
    try {
        var chRes = await fetch(
            SUPABASE_URL + "/rest/v1/channels_data?select=data&order=published_at.desc&limit=1",
            { headers: sbHeaders }
        );

        if (!chRes.ok) return errResponse("Erreur chargement chaînes. Réessayez.", 503, CORS);

        var rows = await chRes.json();
        if (rows && rows.length > 0 && Array.isArray(rows[0].data)) {
            var data = rows[0].data;
            for (var i = 0; i < data.length; i++) {
                var ch = data[i];
                if (!ch.url) continue;
                channels.push({
                    index:    i,
                    name:     (ch.name     || "Chaine").trim(),
                    logo:     ch.logo      || "",
                    category: ch.category  || "Autres",
                });
            }
        }
    } catch(e) {
        return errResponse("Erreur serveur chaînes. Réessayez.", 503, CORS);
    }

    if (channels.length === 0) {
        return errResponse("Aucune chaîne disponible.", 404, CORS);
    }

    // ── 5. Filtres ───────────────────────────────────────────
    if (category) {
        channels = channels.filter(function(c) {
            return (c.category || "").toLowerCase().indexOf(category) !== -1;
        });
    }
    if (search) {
        channels = channels.filter(function(c) {
            return (c.name || "").toLowerCase().indexOf(search) !== -1;
        });
    }

    // ── 6. Format JSON ───────────────────────────────────────
    if (format === "json") {
        var safe = channels.map(function(c) {
            return { index: c.index, name: c.name, logo: c.logo, category: c.category };
        });
        return new Response(JSON.stringify(safe, null, 2), {
            status: 200,
            headers: Object.assign({}, CORS, {
                "Content-Type":  "application/json; charset=utf-8",
                "Cache-Control": "no-store",
            })
        });
    }

    // ── 7. Format M3U avec did intégré ───────────────────────
    // Chaque URL contient le device_id de cet appareil
    // stream.js vérifiera que ce did est bien enregistré
    var m3u  = "#EXTM3U x-tvg-url=\"\" tvg-shift=0\n";
        m3u += "# My Box Smart - " + channels.length + " chaines\n";
        m3u += "# " + new Date().toISOString().split("T")[0] + "\n\n";

    for (var j = 0; j < channels.length; j++) {
        var c    = channels[j];
        var name = (c.name     || "Chaine").replace(/"/g,"'").replace(/,/g," ").trim();
        var logo = (c.logo     || "").trim();
        var cat  = (c.category || "Autres").replace(/"/g,"'").replace(/,/g," ").trim();
        var num  = j + 1;

        // URL proxy avec device_id — jamais le vrai lien
        var proxyUrl = baseUrl + "/stream?key=" + encodeURIComponent(userKey) +
                       "&ch=" + c.index +
                       "&did=" + deviceId;

        m3u += "#EXTINF:-1 tvg-id=\"" + num + "\" tvg-chno=\"" + num + "\" tvg-name=\"" + name + "\"";
        if (logo) m3u += " tvg-logo=\"" + logo + "\"";
        m3u += " group-title=\"" + cat + "\"," + name + "\n";
        m3u += proxyUrl + "\n\n";
    }

    return new Response(m3u, {
        status: 200,
        headers: Object.assign({}, CORS, {
            "Content-Type":        "application/x-mpegURL; charset=utf-8",
            "Content-Disposition": "attachment; filename=\"myboxsmart.m3u\"",
            "Cache-Control":       "no-store, no-cache",
            "X-Total-Channels":    String(channels.length),
            "X-Device-Id":         deviceId,
        })
    });
}
