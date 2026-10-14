import { getStore } from '@netlify/blobs';
import { cleanup } from '../lib/share-core.mjs';

// Runs once a day (see config). Deletes short links nobody has opened for 90 days.
export default async () => {
  const removed = await cleanup(
    getStore({ name: 'shares', consistency: 'strong' }),
    getStore({ name: 'ratelimit' }),
    undefined,
    getStore({ name: 'stats', consistency: 'strong' }),
  );
  console.log('Film Room cleanup: removed', removed, 'expired links');
};

export const config = { schedule: '@daily' };
