// A relay as deployed before live editing, for journeys/live-editing.mjs: it has no rooms, so /v1/rooms and
// /v1/room/:id answer 404 not_found, as that relay's Worker did for any path it didn't know.
const CORS = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };
export default {
  async fetch(): Promise<Response> {
    return new Response(JSON.stringify({ error: 'not_found' }), { status: 404, headers: CORS });
  },
};
