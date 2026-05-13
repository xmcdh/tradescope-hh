import { handleOptions } from '../server/security.js';
import { loadPaperHealth } from '../src/lib/paperHealth.js';

export default async function handler(req, res) {
  if (handleOptions(req, res, 'GET,OPTIONS')) {
    return;
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed.' });
  }

  try {
    const health = await loadPaperHealth();
    return res.status(200).json(health);
  } catch (error) {
    return res.status(500).json({
      error: 'Unable to load paper tracking health.',
      message: error?.message ?? 'Unknown error',
    });
  }
}
