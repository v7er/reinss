import express from 'express';
import { total } from './total.js';

const app = express();

app.get('/api/total', (req, res) => {
  res.json({ total: total([1, 2, 3]) });
});

app.listen(3000);
