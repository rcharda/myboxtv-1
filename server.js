const express = require('express');
const axios = require('axios');
const path = require('path');

const app = express();
const PORT = 3000;

// Autorise l'accès CORS pour le client local
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', '*');
  next();
});

// Sert le fichier t.html
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 't.html'));
});

// Route Proxy qui nettoie la vidéo et enlève le blocage iframe
app.get('/proxy', async (req, res) => {
  const targetUrl = req.query.url;
  if (!targetUrl) return res.status(400).send('URL manquante');

  try {
    const response = await axios.get(targetUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Referer': 'https://vixsrc.to/'
      },
      responseType: 'text'
    });

    // Suppression des en-têtes qui bloquent l'affichage en iframe
    res.removeHeader('Content-Security-Policy');
    res.removeHeader('X-Frame-Options');

    res.send(response.data);
  } catch (error) {
    res.status(500).send('Erreur lors du chargement du lecteur');
  }
});

app.listen(PORT, () => {
  console.log(`Serveur démarré : http://localhost:${PORT}`);
});
