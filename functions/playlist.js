/**
 * ============================================================
 * MY BOX SMART — PLAYLIST M3U UNIVERSELLE
 * Cloudflare Pages Function
 *
 * EMPLACEMENT : /functions/playlist.js
 *
 * URLS :
 *   /playlist                         → toutes les chaînes (sans auth)
 *   /playlist?key=TV-XXXXXX           → vérifie l'abonnement
 *   /playlist?key=TV-XXXXXX&cat=Sport → filtrer par catégorie
 *   /playlist?key=TV-XXXXXX&search=bein → filtrer par nom
 *   /playlist?key=TV-XXXXXX&format=json → format JSON
 * ============================================================
 */

const SUPABASE_URL = "https://yvcdadenofftnbljutwk.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inl2Y2RhZGVub2ZmdG5ibGp1dHdrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI4NzQ0ODIsImV4cCI6MjA4ODQ1MDQ4Mn0.xqJzLpQszFmph599FBIvdE7NF88_i-JkABG-aSrAndE";

const TOP_CHANNELS = [
    { name:"Ivoire Channel", url:"https://video1.getstreamhosting.com:1936/8244/8244/playlist.m3u8", logo:"https://upload.wikimedia.org/wikipedia/commons/f/fe/Flag_of_C%C3%B4te_d%27Ivoire.svg", category:"Ivoirien" },
    { name:"A+ Ivoire",      url:"http://69.64.57.208/atv/playlist.m3u8",                            logo:"https://upload.wikimedia.org/wikipedia/commons/f/fe/Flag_of_C%C3%B4te_d%27Ivoire.svg", category:"Ivoirien" },
    { name:"Novelas TV",     url:"https://stormcast-telenovelatv-1-fr.samsung.wurl.tv/playlist.m3u8", logo:"https://upload.wikimedia.org/wikipedia/commons/2/29/Novelas_TV_Logo.png",               category:"Divertissement" },
];

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

export async function onRequest(context) {
    var request = context.request;
    var reqUrl  = new URL(request.url);
    var params  = reqUrl.searchParams;

    var CORS = {
        "Access-Control-Allow-Origin":  "*",
        "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
    };

    if (request.method === "OPTIONS") {
        return new Response(null, { status: 204, headers: CORS });
    }

    var userKey  = (params.get("key")    || "").trim().toUpperCase();
    var category = (params.get("cat")    || "").trim().toLowerCase();
    var search   = (params.get("search") || "").trim().toLowerCase();
    var format   = (params.get("format") || "m3u").toLowerCase();

    var sbHeaders = {
        "apikey":        SUPABASE_KEY,
        "Authorization": "Bearer " + SUPABASE_KEY,
        "Content-Type":  "application/json",
    };

    // ── Vérification abonnement ──────────────────────────────
    if (userKey) {
        try {
            var authRes = await fetch(
                SUPABASE_URL + "/rest/v1/utilisateurs?cle=eq." +
                encodeURIComponent(userKey) +
                "&select=cle,duree,date_activation&limit=1",
                { headers: sbHeaders }
            );
            if (authRes.ok) {
                var users = await authRes.json();
                if (!users || users.length === 0) {
                    return new Response(
                        "ID invalide. Abonnez-vous sur myboxsmart.pages.dev",
                        { status: 403, headers: Object.assign({}, CORS, { "Content-Type": "text/plain; charset=utf-8" }) }
                    );
                }
                var daysLeft = calcDaysLeft(users[0]);
                if (daysLeft <= 0 && users[0].duree !== "VIE") {
                    return new Response(
                        "Abonnement expire. Renouvelez sur myboxsmart.pages.dev",
                        { status: 403, headers: Object.assign({}, CORS, { "Content-Type": "text/plain; charset=utf-8" }) }
                    );
                }
            }
        } catch(e) {
            // Mode dégradé : continuer sans vérification
        }
    }

    // ── Récupérer les chaînes ────────────────────────────────
    var channels = TOP_CHANNELS.slice();

    try {
        var chRes = await fetch(
            SUPABASE_URL + "/rest/v1/channels_data?select=data&order=published_at.desc&limit=1",
            { headers: sbHeaders }
        );
        if (chRes.ok) {
            var rows = await chRes.json();
            if (rows && rows.length > 0 && Array.isArray(rows[0].data)) {
                var topUrls = {};
                for (var t = 0; t < TOP_CHANNELS.length; t++) {
                    topUrls[TOP_CHANNELS[t].url] = true;
                }
                var data = rows[0].data;
                for (var i = 0; i < data.length; i++) {
                    var ch = data[i];
                    if (ch.url && !topUrls[ch.url]) {
                        channels.push({
                            name:     (ch.name     || "Chaine").trim(),
                            url:      ch.url.trim(),
                            logo:     ch.logo     || "",
                            category: ch.category || "Autres",
                        });
                    }
                }
            }
        }
    } catch(e) {
        // Supabase indisponible → retourner TOP_CHANNELS seulement
    }

    // ── Filtres ──────────────────────────────────────────────
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

    // ── Format JSON ──────────────────────────────────────────
    if (format === "json") {
        return new Response(JSON.stringify(channels, null, 2), {
            status: 200,
            headers: Object.assign({}, CORS, {
                "Content-Type":  "application/json; charset=utf-8",
                "Cache-Control": "public, max-age=300",
            })
        });
    }

    // ── Format M3U ───────────────────────────────────────────
    // Compatible : TiviMate · IPTV Smarters · GSE · VLC · Kodi
    //              Perfect Player · OTT Navigator · Infuse · nPlayer
    var m3u  = "#EXTM3U x-tvg-url=\"\" tvg-shift=0\n";
        m3u += "# My Box Smart - " + channels.length + " chaines\n";
        m3u += "# " + new Date().toISOString().split("T")[0] + "\n\n";

    for (var j = 0; j < channels.length; j++) {
        var c   = channels[j];
        var url = (c.url || "").trim();
        if (!url) continue;

        var name = (c.name     || "Chaine").replace(/"/g,"'").replace(/,/g," ").trim();
        var logo = (c.logo     || "").trim();
        var cat  = (c.category || "Autres").replace(/"/g,"'").replace(/,/g," ").trim();
        var num  = j + 1;

        m3u += "#EXTINF:-1 tvg-id=\"" + num + "\" tvg-chno=\"" + num + "\" tvg-name=\"" + name + "\"";
        if (logo) m3u += " tvg-logo=\"" + logo + "\"";
        m3u += " group-title=\"" + cat + "\"," + name + "\n";
        m3u += url + "\n\n";
    }

    return new Response(m3u, {
        status: 200,
        headers: Object.assign({}, CORS, {
            "Content-Type":        "application/x-mpegURL; charset=utf-8",
            "Content-Disposition": "attachment; filename=\"myboxsmart.m3u\"",
            "Cache-Control":       "public, max-age=300, s-maxage=300",
            "X-Total-Channels":    String(channels.length),
        })
    });
}
