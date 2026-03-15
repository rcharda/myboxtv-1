/**
 * ============================================================
 * MY BOX SMART — PROXY DE FLUX
 * Cloudflare Pages Function : /functions/stream.js
 *
 * Le client voit ce lien dans son lecteur :
 *   https://myboxsmart.pages.dev/stream?key=TV-XXXXX&ch=42
 *
 * Ce fichier :
 *   1. Vérifie que la clé est valide et non expirée
 *   2. Récupère le vrai lien de la chaîne depuis Supabase
 *   3. Redirige vers le vrai flux (302)
 *   → Le vrai lien n'est JAMAIS exposé au client
 * ============================================================
 */

const SUPABASE_URL = "https://yvcdadenofftnbljutwk.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inl2Y2RhZGVub2ZmdG5ibGp1dHdrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI4NzQ0ODIsImV4cCI6MjA4ODQ1MDQ4Mn0.xqJzLpQszFmph599FBIvdE7NF88_i-JkABG-aSrAndE";

const TOP_CHANNELS = [
    { name:"Ivoire Channel", url:"https://video1.getstreamhosting.com:1936/8244/8244/playlist.m3u8", logo:"https://upload.wikimedia.org/wikipedia/commons/f/fe/Flag_of_C%C3%B4te_d%27Ivoire.svg", category:"Ivoirien" },
    { name:"A+ Ivoire",      url:"http://69.64.57.208/atv/playlist.m3u8",                            logo:"https://upload.wikimedia.org/wikipedia/commons/f/fe/Flag_of_C%C3%B4te_d%27Ivoire.svg", category:"Ivoirien" },
    { name:"Novelas TV",     url:"https://stormcast-telenovelatv-1-fr.samsung.wurl.tv/playlist.m3u8", logo:"https://upload.wikimedia.org/wikipedia/commons/2/29/Novelas_TV_Logo.png",               category:"Divertissement" },
];

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
    var chIndex = parseInt(params.get("ch") || "-1");

    // ── 1. Clé obligatoire ───────────────────────────────────
    if (!userKey) {
        return errResponse("Acces refuse - clé manquante", 403);
    }
    if (isNaN(chIndex) || chIndex < 0) {
        return errResponse("Acces refuse - chaîne invalide", 400);
    }

    // ── 2. Vérifier l'abonnement dans Supabase ───────────────
    try {
        var authRes = await fetch(
            SUPABASE_URL + "/rest/v1/utilisateurs?cle=eq." +
            encodeURIComponent(userKey) +
            "&select=cle,duree,date_activation&limit=1",
            { headers: sbHeaders }
        );

        if (!authRes.ok) {
            return errResponse("Erreur serveur", 503);
        }

        var users = await authRes.json();

        if (!users || users.length === 0) {
            return errResponse("Acces refuse - ID invalide", 403);
        }

        var daysLeft = calcDaysLeft(users[0]);
        if (daysLeft <= 0 && users[0].duree !== "VIE") {
            return errResponse("Acces refuse - abonnement expire", 403);
        }

    } catch(e) {
        return errResponse("Erreur serveur temporaire", 503);
    }

    // ── 3. Récupérer le vrai lien de la chaîne ───────────────
    var realUrl = "";

    try {
        // TOP_CHANNELS en tête (index 0, 1, 2)
        if (chIndex < TOP_CHANNELS.length) {
            realUrl = TOP_CHANNELS[chIndex].url;
        } else {
            // Chercher dans Supabase channels_data
            var chRes = await fetch(
                SUPABASE_URL + "/rest/v1/channels_data?select=data&order=published_at.desc&limit=1",
                { headers: sbHeaders }
            );

            if (chRes.ok) {
                var rows = await chRes.json();
                if (rows && rows.length > 0 && Array.isArray(rows[0].data)) {
                    // Index dans channels_data = chIndex - TOP_CHANNELS.length
                    var dataIndex = chIndex - TOP_CHANNELS.length;
                    var chData    = rows[0].data[dataIndex];
                    if (chData && chData.url) {
                        realUrl = chData.url;
                    }
                }
            }
        }
    } catch(e) {
        return errResponse("Erreur récupération chaîne", 503);
    }

    if (!realUrl) {
        return errResponse("Chaîne introuvable", 404);
    }

    // ── 4. Redirection 302 vers le vrai flux ─────────────────
    // Le vrai lien n'apparaît JAMAIS dans le fichier M3U du client
    // Le lecteur IPTV suit la redirection et lit le flux
    return new Response(null, {
        status: 302,
        headers: {
            "Location":                    realUrl,
            "Access-Control-Allow-Origin": "*",
            "Cache-Control":               "no-store, no-cache",
        }
    });
}
