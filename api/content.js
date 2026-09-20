import { put, list } from '@vercel/blob';

const BLOB_PATH = 'orenti/content.json';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // GET: получить сохранённый контент
  if (req.method === 'GET') {
    try {
      const { blobs } = await list({ prefix: BLOB_PATH });
      if (blobs.length === 0) return res.status(200).json({});
      const response = await fetch(blobs[0].url);
      const data = await response.json();
      return res.status(200).json(data);
    } catch (error) {
      console.error('GET error:', error);
      return res.status(200).json({});
    }
  }

  // POST: сохранить контент
  if (req.method === 'POST') {
    try {
      const auth = req.headers.authorization || '';
      const expectedToken = process.env.EDIT_TOKEN || '';
      if (expectedToken && !auth.includes(expectedToken)) {
        return res.status(401).json({ error: 'Unauthorized' });
      }
      const content = req.body;
      await put(BLOB_PATH, JSON.stringify(content), {
        access: 'public',
        allowOverwrite: true,
        contentType: 'application/json'
      });
      return res.status(200).json({ ok: true });
    } catch (error) {
      console.error('POST error:', error);
      return res.status(500).json({ error: 'Save failed' });
    }
  }
  return res.status(405).json({ error: 'Method not allowed' });
}