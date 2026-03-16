/**
 * ============================================================
 * MY BOX SMART — PROXY DE FLUX AVEC TOKEN TEMPORAIRE
 * Cloudflare Pages Function : /functions/stream.js
 *
 * DEUX modes :
 *
 * MODE 1 — Génération du token (appelé par playlist.js)
 *   /stream?key=CLE&ch=42
 *   → Vérifie l'abonnement
 *   → Génère un token signé valable 4h
 *   → Redirige vers /stream?tok=TOKEN&ch=42
 *
 * MODE 2 — Lecture avec token (appelé par le lecteur IPTV)
 *   /stream?tok=TOKEN&ch=42
 *   → Vérifie que le token est valide et non expiré
 *   → Redirige 302 vers le vrai flux
 *   → Si token expiré → 403 (le client doit retélécharger le M3U)
 *
 * SÉCURITÉ :
 *   - Token signé avec HMAC-SHA256 (SECRET_KEY)
 *   - Token expire après 4 heures
 *   - Impossible à falsifier sans connaître SECRET_KEY
 *   - Client ne voit jamais le vrai lien
 * ============================================================
 */

const SUPABASE_URL = "https://yvcdadenofftnbljutwk.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inl2Y2RhZGVub2ZmdG5ibGp1dHdrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI4NzQ0ODIsImV4cCI6MjA4ODQ1MDQ4Mn0.xqJzLpQszFmph599FBIvdE7NF88_i-JkABG-aSrAndE";

// ⚠️ CHANGEZ CE SECRET — chaîne aléatoire connue uniquement de votre serveur
const SECRET_KEY = "Maman Yasmine1@";

// Durée de validité du token en secondes (4 heures)
const TOKEN_TTL = 4 * 60 * 60;

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

// Générer un HMAC-SHA256
async function hmacSign(message, secret) {
    var enc     = new TextEncoder();
    var keyData = enc.encode(secret);
    var msgData = enc.encode(message);
    var key = await crypto.subtle.importKey(
        "raw", keyData,
        { name: "HMAC", hash: "SHA-256" },
        false, ["sign"]
    );
    var sig    = await crypto.subtle.sign("HMAC", key, msgData);
    var bytes  = new Uint8Array(sig);
    var hex    = Array.from(bytes).map(b => b.toString(16).padStart(2,"0")).join("");
    return hex;
}

// Créer un token : base64(chIndex + ":" + expiry) + "." + signature
async function createToken(userKey, chIndex) {
    var expiry  = Math.floor(Date.now() / 1000) + TOKEN_TTL;
    var payload = chIndex + ":" + expiry + ":" + userKey;
    var sig     = await hmacSign(payload, SECRET_KEY);
    var b64     = btoa(payload);
    return b64 + "." + sig;
}

// Vérifier et décoder un token
async function verifyToken(token) {
    try {
        var parts = token.split(".");
        if (parts.length !== 2) return null;
        var payload = atob(parts[0]);
        var sig     = parts[1];

        // Vérifier la signature
        var expected = await hmacSign(payload, SECRET_KEY);
        if (expected !== sig) return null;

        // Vérifier l'expiration
        var segments = payload.split(":");
        if (segments.length < 3) return null;
        var chIndex  = parseInt(segments[0]);
        var expiry   = parseInt(segments[1]);
        var userKey  = segments.slice(2).join(":");

        if (Math.floor(Date.now() / 1000) > expiry) return null; // expiré

        return { chIndex: chIndex, userKey: userKey, expiry: expiry };
    } catch(e) {
        return null;
    }
}

export async function onRequest(context) {
    var request = context.request;
    var reqUrl  = new URL(request.url);
    var params  = reqUrl.searchParams;

    if (request.method === "OPTIONS") {
        return new Response(null, {
            status: 204,
            headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET" }
        });
    }

    var userKey = (params.get("key") || "").trim().toUpperCase();
    var tokStr  = params.get("tok") || "";
    var chIndex = parseInt(params.get("ch") || "-1");

    // ══════════════════════════════════════════════════════════
    // MODE 2 — Lecture avec token (appelé par le lecteur IPTV)
    // Le lecteur a un token dans son M3U → on vérifie et on redirige
    // ══════════════════════════════════════════════════════════
    if (tokStr) {
        var decoded = await verifyToken(tokStr);

        if (!decoded) {
            return errResponse(
                "Lien expiré. Retéléchargez votre playlist sur myboxsmart.pages.dev",
                403
            );
        }

        // Token valide → récupérer le vrai lien et rediriger
        try {
            var chRes = await fetch(
                SUPABASE_URL + "/rest/v1/channels_data?select=data&order=published_at.desc&limit=1",
                { headers: sbHeaders }
            );

            if (!chRes.ok) return errResponse("Erreur serveur.", 503);

            var rows = await chRes.json();
            if (!rows || rows.length === 0 || !Array.isArray(rows[0].data)) {
                return errResponse("Chaîne introuvable.", 404);
            }

            var chData = rows[0].data[decoded.chIndex];
            if (!chData || !chData.url) return errResponse("Chaîne introuvable.", 404);

            // 302 vers le vrai flux — token valide, abonnement vérifié à la génération
            return new Response(null, {
                status: 302,
                headers: {
                    "Location":                    chData.url,
                    "Access-Control-Allow-Origin": "*",
                    "Cache-Control":               "no-store, no-cache",
                }
            });

        } catch(e) {
            return errResponse("Erreur serveur.", 503);
        }
    }

    // ══════════════════════════════════════════════════════════
    // MODE 1 — Génération du token (appelé au téléchargement M3U)
    // ══════════════════════════════════════════════════════════
    if (!userKey) {
        return errResponse("Accès refusé - clé manquante", 403);
    }
    if (isNaN(chIndex) || chIndex < 0) {
        return errResponse("Accès refusé - chaîne invalide", 400);
    }

    // Vérifier l'abonnement dans Supabase (BLOQUANT)
    try {
        var authRes = await fetch(
            SUPABASE_URL + "/rest/v1/utilisateurs?cle=eq." +
            encodeURIComponent(userKey) +
            "&select=cle,duree,date_activation&limit=1",
            { headers: sbHeaders }
        );

        if (!authRes.ok) return errResponse("Erreur serveur. Réessayez.", 503);

        var users = await authRes.json();
        if (!users || users.length === 0) {
            return errResponse("Accès refusé - clé invalide", 403);
        }

        var daysLeft = calcDaysLeft(users[0]);
        if (daysLeft <= 0 && users[0].duree !== "VIE") {
            return errResponse("Accès refusé - abonnement expiré", 403);
        }

    } catch(e) {
        return errResponse("Erreur serveur temporaire.", 503);
    }

    // Générer le token signé (valable 4h)
    var token    = await createToken(userKey, chIndex);
    var tokenUrl = reqUrl.origin + "/stream?tok=" + encodeURIComponent(token) + "&ch=" + chIndex;

    // Rediriger vers l'URL avec token
    return new Response(null, {
        status: 302,
        headers: {
            "Location":                    tokenUrl,
            "Access-Control-Allow-Origin": "*",
            "Cache-Control":               "no-store, no-cache",
        }
    });
}
