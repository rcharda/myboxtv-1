/**
 * ============================================================
 * MY BOX SMART — PLAYLIST M3U SÉCURISÉE
 * Cloudflare Pages Function : /functions/playlist.js
 *
 * Les vrais liens des chaînes ne sont JAMAIS dans le fichier M3U.
 * À la place, le client reçoit des liens proxy :
 *   https://myboxsmart.pages.dev/stream?key=TV-XXXXX&ch=42
 *
 * Le lecteur IPTV appelle ce lien → vérification clé → redirection
 * vers le vrai flux. Le client ne voit jamais l'URL réelle.
 * ============================================================
 */

const SUPABASE_URL = "https://yvcdadenofftnbljutwk.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inl2Y2RhZGVub2ZmdG5ibGp1dHdrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI4NzQ0ODIsImV4cCI6MjA4ODQ1MDQ4Mn0.xqJzLpQszFmph599FBIvdE7NF88_i-JkABG-aSrAndE";

const TOP_CHANNELS = [
    { name:"Ivoire Channel", logo:"https://upload.wikimedia.org/wikipedia/commons/f/fe/Flag_of_C%C3%B4te_d%27Ivoire.svg", category:"Ivoirien" },
    { name:"A+ Ivoire",      logo:"https://upload.wikimedia.org/wikipedia/commons/f/fe/Flag_of_C%C3%B4te_d%27Ivoire.svg", category:"Ivoirien" },
    { name:"Novelas TV",     logo:"https://upload.wikimedia.org/wikipedia/commons/2/29/Novelas_TV_Logo.png",               category:"Divertissement" },
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
    var baseUrl = reqUrl.origin; // https://myboxsmart.pages.dev

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

    var sbHeaders = {
        "apikey":        SUPABASE_KEY,
        "Authorization": "Bearer " + SUPABASE_KEY,
        "Content-Type":  "application/json",
    };

    // ── 1. Vérification abonnement (obligatoire) ─────────────
    if (!userKey) {
        return new Response(
            "Clé manquante. Utilisez /playlist?key=VOTRE-ID",
            { status: 400, headers: Object.assign({}, CORS, { "Content-Type": "text/plain; charset=utf-8" }) }
        );
    }

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
        return new Response("Erreur serveur", { status: 503, headers: CORS });
    }

    // ── 2. Construire la liste des chaînes (sans les vrais liens) ─
    // Les TOP_CHANNELS n'ont pas d'URL ici — juste nom/logo/catégorie
    // Les vrais liens sont dans Supabase, jamais exposés
    var channels = [];

    // Ajouter TOP_CHANNELS (index 0, 1, 2)
    for (var t = 0; t < TOP_CHANNELS.length; t++) {
        channels.push({
            index:    t,
            name:     TOP_CHANNELS[t].name,
            logo:     TOP_CHANNELS[t].logo,
            category: TOP_CHANNELS[t].category,
        });
    }

    // Ajouter les chaînes de Supabase (index 3, 4, 5...)
    try {
        var chRes = await fetch(
            SUPABASE_URL + "/rest/v1/channels_data?select=data&order=published_at.desc&limit=1",
            { headers: sbHeaders }
        );
        if (chRes.ok) {
            var rows = await chRes.json();
            if (rows && rows.length > 0 && Array.isArray(rows[0].data)) {
                var data = rows[0].data;
                for (var i = 0; i < data.length; i++) {
                    var ch = data[i];
                    if (!ch.url) continue;
                    channels.push({
                        index:    TOP_CHANNELS.length + i,  // index global
                        name:     (ch.name     || "Chaine").trim(),
                        logo:     ch.logo     || "",
                        category: ch.category || "Autres",
                        // PAS d'URL ici — jamais exposée
                    });
                }
            }
        }
    } catch(e) {
        // Supabase indisponible → TOP_CHANNELS seulement
    }

    // ── 3. Filtres ───────────────────────────────────────────
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

    // ── 4. Format JSON (sans vrais liens) ────────────────────
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

    // ── 5. Format M3U SÉCURISÉ ───────────────────────────────
    // Chaque URL dans le M3U pointe vers le PROXY (/stream)
    // Le vrai lien n'apparaît NULLE PART dans ce fichier
    var m3u  = "#EXTM3U x-tvg-url=\"\" tvg-shift=0\n";
        m3u += "# My Box Smart - " + channels.length + " chaines\n";
        m3u += "# " + new Date().toISOString().split("T")[0] + "\n\n";

    for (var j = 0; j < channels.length; j++) {
        var c    = channels[j];
        var name = (c.name     || "Chaine").replace(/"/g,"'").replace(/,/g," ").trim();
        var logo = (c.logo     || "").trim();
        var cat  = (c.category || "Autres").replace(/"/g,"'").replace(/,/g," ").trim();
        var num  = j + 1;

        // ⚠️ URL PROXY — jamais le vrai lien
        var proxyUrl = baseUrl + "/stream?key=" + encodeURIComponent(userKey) + "&ch=" + c.index;

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
            "Cache-Control":       "no-store, no-cache", // ne pas mettre en cache
            "X-Total-Channels":    String(channels.length),
        })
    });
}
