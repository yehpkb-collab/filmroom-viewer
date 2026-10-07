import { getStore } from '@netlify/blobs';
import { handle } from '../lib/share-core.mjs';

export default async (req, context) => {
  try {
    return await handle(req, {
      shares: getStore({ name: 'shares', consistency: 'strong' }),
      rates: getStore({ name: 'ratelimit' }),
      ip: context && context.ip,
    });
  } catch (err) {
    console.error('share function error', err);
    return new Response(JSON.stringify({ error: 'Server error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });
  }
};

export const config = { path: ['/api/share', '/api/share/*'] };
