import express from 'express';
import app from './api/index.js';

const dev = express();
dev.use(express.static('public', { extensions: ['html'] }));
dev.use(app);
const port = process.env.PORT || 3000;
dev.listen(port, () => console.log('AR Academy running on http://localhost:' + port));
