/**
 * ============================================================
 * MY BOX SMART — PROXY DE FLUX (SANS REDIRECT)
 * Cloudflare Pages Function : /functions/stream.js
 *
 * Le client voit ce lien dans son lecteur :
 *   https://myboxsmart.pages.dev/stream?key=CLE-XXXXX&ch=42
 *
 * Ce fichier :
 *   1. Vérifie que la clé est valide et non expirée
 *   2. Récupère le vrai lien depuis Supabase
 *   3. Télécharge la playlist M3U8 et la retransmet (PROXY RÉEL)
 *   4. Remplace toutes les URLs par des URLs proxy
 *   → Le vrai lien n'est JAMAIS visible par le client
 *   → Même si le client capture le trafic réseau
 *   → Abonnement expiré = tout bloqué immédiatement
 * ============================================================
 */

const SUPABASE_URL = "https://yvcdadenofftnbljutwk.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inl2Y2RhZGVub2ZmdG5ibGp1dHdrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI4NzQ0ODIsImV4cCI6MjA4ODQ1MDQ4Mn0.xqJzLpQszFmph599FBIvdE7NF88_i-JkABG-aSrAndE";

var sbHeaders = {
    "apikey":        SUPABASE_KEY,
    "Authorization": "Bearer " + SUPABASE_KEY,
    "Content-Type":  "application/json",
};

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

function errResponse(msg, status) {
    return new Response(msg, {
        status: status || 403,
        headers: {
            "Content-Type":                "text/plain; charset=utf-8",
            "Access-Control-Allow-Origin": "*",
        }
    });
}

// Convertir une URL relative en URL absolue
function resolveUrl(base, relative) {
    if (!relative) return "";
    if (relative.startsWith("http://") || relative.startsWith("https://")) return relative;
    try {
        return new URL(relative, base).href;
    } catch(e) {
        return relative;
    }
}

// Remplacer toutes les URLs dans une playlist M3U8 par des URLs proxy
function rewriteM3U8(content, realBaseUrl, proxyBaseUrl, userKey, chIndex) {
    var lines  = content.split("\n");
    var result = [];

    for (var i = 0; i < lines.length; i++) {
        var line = lines[i].trim();

        if (line === "") {
            result.push("");
            continue;
        }

        // Ligne URL (segment .ts ou sous-playlist .m3u8)
        if (!line.startsWith("#")) {
            var absoluteUrl = resolveUrl(realBaseUrl, line);
            var proxied = proxyBaseUrl + "/stream?key=" + encodeURIComponent(userKey) +
                          "&ch=" + chIndex +
                          "&seg=" + encodeURIComponent(absoluteUrl);
            result.push(proxied);
            continue;
        }

        // Ligne avec URI= (clés AES, sous-playlists audio/video)
        if (line.includes('URI="')) {
            line = line.replace(/URI="([^"]+)"/g, function(match, uri) {
                var absoluteUri = resolveUrl(realBaseUrl, uri);
                var proxied = proxyBaseUrl + "/stream?key=" + encodeURIComponent(userKey) +
                              "&ch=" + chIndex +
                              "&seg=" + encodeURIComponent(absoluteUri);
                return 'URI="' + proxied + '"';
            });
        }

        result.push(line);
    }

    return result.join("\n");
}

export async function onRequest(context) {
    var request = context.request;
    var reqUrl  = new URL(request.url);
    var params  = reqUrl.searchParams;
    var baseUrl = reqUrl.origin;

    if (request.method === "OPTIONS") {
        return new Response(null, {
            status: 204,
            headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET" }
        });
    }

    var userKey = (params.get("key") || "").trim().toUpperCase();
    var chIndex = parseInt(params.get("ch") || "-1");
    var segUrl  = params.get("seg") || "";

    // ── 1. Clé obligatoire ───────────────────────────────────
    if (!userKey) {
        return errResponse("Accès refusé - clé manquante", 403);
    }

    // ── 2. Vérifier abonnement à CHAQUE requête (BLOQUANT) ───
    // Vérifié pour la playlist ET pour chaque segment
    // → Dès que l'abonnement expire, tout s'arrête immédiatement
    try {
        var authRes = await fetch(
            SUPABASE_URL + "/rest/v1/utilisateurs?cle=eq." +
            encodeURIComponent(userKey) +
            "&select=cle,duree,date_activation&limit=1",
            { headers: sbHeaders }
        );

        if (!authRes.ok) {
            return errResponse("Erreur serveur. Réessayez dans quelques instants.", 503);
        }

        var users = await authRes.json();

        if (!users || users.length === 0) {
            return errResponse("Accès refusé - clé invalide", 403);
        }

        var daysLeft = calcDaysLeft(users[0]);
        if (daysLeft <= 0 && users[0].duree !== "VIE") {
            return errResponse("Accès refusé - abonnement expiré", 403);
        }

    } catch(e) {
        return errResponse("Erreur serveur temporaire. Réessayez.", 503);
    }

    // ── 3. Proxy d'un segment (ts, clé AES, sous-playlist) ───
    // Le lecteur IPTV demande chaque segment → on vérifie l'abo
    // puis on retransmet le contenu sans exposer le vrai lien
    if (segUrl) {
        try {
            var segRes = await fetch(segUrl, {
                headers: { "User-Agent": "Mozilla/5.0 (compatible; IPTV)" }
            });

            if (!segRes.ok) {
                return errResponse("Segment introuvable", 404);
            }

            var contentType = segRes.headers.get("content-type") || "application/octet-stream";

            // Sous-playlist M3U8 → réécrire aussi ses URLs
            if (contentType.includes("mpegurl") || segUrl.includes(".m3u8") || segUrl.includes("playlist")) {
                var subContent = await segRes.text();
                var subBase    = segUrl.substring(0, segUrl.lastIndexOf("/") + 1);
                var rewritten  = rewriteM3U8(subContent, subBase, baseUrl, userKey, chIndex);
                return new Response(rewritten, {
                    status: 200,
                    headers: {
                        "Content-Type":                "application/vnd.apple.mpegurl",
                        "Access-Control-Allow-Origin": "*",
                        "Cache-Control":               "no-store, no-cache",
                    }
                });
            }

            // Segment vidéo .ts ou clé AES → retransmettre tel quel
            return new Response(segRes.body, {
                status: 200,
                headers: {
                    "Content-Type":                contentType,
                    "Access-Control-Allow-Origin": "*",
                    "Cache-Control":               "no-store, no-cache",
                }
            });

        } catch(e) {
            return errResponse("Erreur proxy segment", 502);
        }
    }

    // ── 4. Récupérer le vrai lien depuis Supabase ────────────
    if (isNaN(chIndex) || chIndex < 0) {
        return errResponse("Accès refusé - chaîne invalide", 400);
    }

    var realUrl = "";
    try {
        var chRes = await fetch(
            SUPABASE_URL + "/rest/v1/channels_data?select=data&order=published_at.desc&limit=1",
            { headers: sbHeaders }
        );

        if (!chRes.ok) {
            return errResponse("Erreur chargement chaîne. Réessayez.", 503);
        }

        var rows = await chRes.json();
        if (rows && rows.length > 0 && Array.isArray(rows[0].data)) {
            var chData = rows[0].data[chIndex];
            if (chData && chData.url) {
                realUrl = chData.url;
            }
        }
    } catch(e) {
        return errResponse("Erreur récupération chaîne.", 503);
    }

    if (!realUrl) {
        return errResponse("Chaîne introuvable.", 404);
    }

    // ── 5. Télécharger la playlist M3U8 et réécrire les URLs ─
    // Le vrai lien reste sur le serveur, jamais transmis au client
    try {
        var m3uRes = await fetch(realUrl, {
            headers: { "User-Agent": "Mozilla/5.0 (compatible; IPTV)" }
        });

        if (!m3uRes.ok) {
            return errResponse("Flux indisponible pour le moment.", 502);
        }

        var m3uContent = await m3uRes.text();
        var realBase   = realUrl.substring(0, realUrl.lastIndexOf("/") + 1);

        // Réécrire toutes les URLs → proxy
        var rewritten = rewriteM3U8(m3uContent, realBase, baseUrl, userKey, chIndex);

        return new Response(rewritten, {
            status: 200,
            headers: {
                "Content-Type":                "application/vnd.apple.mpegurl",
                "Access-Control-Allow-Origin": "*",
                "Cache-Control":               "no-store, no-cache",
            }
        });

    } catch(e) {
        return errResponse("Erreur proxy flux.", 502);
    }
}
