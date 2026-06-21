import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// Servir la carpeta dist compilada por Vite
app.use(express.static(path.join(__dirname, 'dist')));

// Redireccionar todas las rutas a index.html para comportamiento SPA
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`[Frontend] Servidor estático corriendo en puerto ${PORT}`);
});
