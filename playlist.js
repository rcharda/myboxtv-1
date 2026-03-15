/**
 * ============================================================
 * MY BOX SMART — PLAYLIST M3U UNIVERSELLE
 * Cloudflare Pages Function : /functions/playlist.js
 *
 * URL d'accès : https://myboxsmart.pages.dev/playlist
 * Avec clé    : https://myboxsmart.pages.dev/playlist?key=TV-XXXXXX
 * ============================================================
 */

const SUPABASE_URL = "https://yvcdadenofftnbljutwk.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inl2Y2RhZGVub2ZmdG5ibGp1dHdrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI4NzQ0ODIsImV4cCI6MjA4ODQ1MDQ4Mn0.xqJzLpQszFmph599FBIvdE7NF88_i-JkABG-aSrAndE";

const SB_HEADERS = {
    "apikey":        SUPABASE_KEY,
    "Authorization": "Bearer " + SUPABASE_KEY,
    "Content-Type":  "application/json",
};

// Chaînes toujours en tête
const TOP_CHANNELS = [
    { name:"Ivoire Channel", url:"https://video1.getstreamhosting.com:1936/8244/8244/playlist.m3u8", logo:"https://upload.wikimedia.org/wikipedia/commons/f/fe/Flag_of_C%C3%B4te_d%27Ivoire.svg", category:"Ivoirien" },
    { name:"A+ Ivoire",      url:"http://69.64.57.208/atv/playlist.m3u8",                            logo:"https://upload.wikimedia.org/wikipedia/commons/f/fe/Flag_of_C%C3%B4te_d%27Ivoire.svg", category:"Ivoirien" },
    { name:"Novelas TV",     url:"https://stormcast-telenovelatv-1-fr.samsung.wurl.tv/playlist.m3u8", logo:"https://upload.wikimedia.org/wikipedia/commons/2/29/Novelas_TV_Logo.png",               category:"Divertissement" },
];

export async function onRequest(context) {
    const { request, env } = context;
    const url = new URL(request.url);
    const params = url.searchParams;

    // Paramètres optionnels
    const userKey  = params.get("key")      || "";
    const category = params.get("cat")      || "";   // filtrer par catégorie
    const search   = params.get("search")   || "";   // filtrer par nom
    const format   = params.get("format")   || "m3u"; // m3u | json
    const noAuth   = params.get("open")     === "1"; // playlist publique sans auth

    // ── Vérification abonnement (optionnel si ?open=1) ──────
    if (userKey && !noAuth) {
        try {
            const r = await fetch(
                `${SUPABASE_URL}/rest/v1/utilisateurs?cle=eq.${encodeURIComponent(userKey)}&select=cle,duree,date_activation`,
                { headers: SB_HEADERS }
            );
            const users = await r.json();
            if (!users || users.length === 0) {
                return new Response("❌ Clé invalide", { status: 403, headers: { "Content-Type": "text/plain" } });
            }
            const user = users[0];
            if (user.duree !== "VIE") {
                const days = parseInt(user.duree) || 0;
                const act  = user.date_activation ? new Date(user.date_activation) : null;
                let daysLeft = days;
                if (act) {
                    const today = new Date();
                    act.setHours(0,0,0,0); today.setHours(0,0,0,0);
                    daysLeft = Math.max(0, days - Math.floor((today - act) / 86400000));
                }
                if (daysLeft <= 0) {
                    return new Response("⛔ Abonnement expiré", { status: 403, headers: { "Content-Type": "text/plain" } });
                }
            }
        } catch(e) {
            // Si erreur Supabase → continuer quand même (mode dégradé)
        }
    }

    // ── Récupérer les chaînes depuis Supabase ────────────────
    let channels = [...TOP_CHANNELS];
    try {
        const r = await fetch(
            `${SUPABASE_URL}/rest/v1/channels_data?select=data&order=published_at.desc&limit=1`,
            { headers: SB_HEADERS }
        );
        const rows = await r.json();
        if (rows && rows.length > 0 && Array.isArray(rows[0].data)) {
            const topUrls = new Set(TOP_CHANNELS.map(c => c.url));
            for (const ch of rows[0].data) {
                if (ch.url && !topUrls.has(ch.url)) {
                    channels.push({ name: ch.name || "Chaîne", url: ch.url, logo: ch.logo || "", category: ch.category || "Autres" });
                }
            }
        }
    } catch(e) {
        // Fallback : retourner seulement les TOP_CHANNELS
    }

    // ── Filtres ──────────────────────────────────────────────
    if (category) {
        channels = channels.filter(c => (c.category || "").toLowerCase().includes(category.toLowerCase()));
    }
    if (search) {
        channels = channels.filter(c => (c.name || "").toLowerCase().includes(search.toLowerCase()));
    }

    // ── Générer la réponse ───────────────────────────────────
    if (format === "json") {
        return new Response(JSON.stringify(channels), {
            headers: {
                "Content-Type":  "application/json",
                "Access-Control-Allow-Origin": "*",
                "Cache-Control": "max-age=300",
            }
        });
    }

    // Format M3U standard (compatible TiviMate, GSE, IPTV Smarters, VLC, Kodi, etc.)
    let m3u = `#EXTM3U x-tvg-url="" tvg-shift=0 catchup="default"\n`;
    m3u += `# My Box Smart — Playlist générée automatiquement\n`;
    m3u += `# ${channels.length} chaînes — ${new Date().toISOString()}\n\n`;

    channels.forEach((ch, i) => {
        const num  = i + 1;
        const name = (ch.name    || "Chaîne").replace(/,/g, " ");
        const logo = ch.logo     || "";
        const cat  = (ch.category || "Autres").replace(/,/g, " ");
        const url  = ch.url      || "";
        if (!url) return;

        m3u += `#EXTINF:-1 tvg-id="${num}" tvg-chno="${num}" tvg-name="${name}" tvg-logo="${logo}" group-title="${cat}",${name}\n`;
        m3u += `${url}\n\n`;
    });

    return new Response(m3u, {
        headers: {
            "Content-Type":                "application/x-mpegURL; charset=utf-8",
            "Content-Disposition":         `attachment; filename="myboxsmart.m3u"`,
            "Access-Control-Allow-Origin": "*",
            "Cache-Control":               "max-age=300, s-maxage=300",
            "X-Channel-Count":             String(channels.length),
        }
    });
}
