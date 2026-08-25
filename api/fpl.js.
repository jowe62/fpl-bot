export default async function handler(req, res) {
  const path = req.query.path;
  if (!path) return res.status(400).json({ error: "Missing path" });
  const url = `https://fantasy.premierleague.com/api${path}`;
  try {
    const upstream = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0", "Referer": "https://fantasy.premierleague.com/" }
    });
    if (!upstream.ok) return res.status(upstream.status).json({ error: "FPL error" });
    const data = await upstream.json();
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Cache-Control", "s-maxage=60");
    return res.status(200).json(data);
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
