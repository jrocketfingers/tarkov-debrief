// ICE server configuration — STUN + TURN via Metered.ca.
//
// STUN (Google public servers): discovers each peer's reflexive IP/port so
// direct P2P paths can be attempted. Free, no account needed.
//
// TURN (Metered.ca relay): fallback relay for peers behind symmetric NAT
// (corporate/university firewalls, VPN) where STUN candidates fail ICE.
// Trystero passes this config to every RTCPeerConnection it creates. §5.6
//
// Credentials are intentionally committed for this squad tool; rotate via
// the Metered.ca dashboard if quota is abused.
export const ICE_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:stun.cloudflare.com:3478' },
  { urls: 'turn:global.relay.metered.ca:80',               username: '370eaf7b79b525ebcdda4228', credential: 'QFVpUuyM5frOCNHU' },
  { urls: 'turn:global.relay.metered.ca:80?transport=tcp', username: '370eaf7b79b525ebcdda4228', credential: 'QFVpUuyM5frOCNHU' },
  { urls: 'turn:global.relay.metered.ca:443',              username: '370eaf7b79b525ebcdda4228', credential: 'QFVpUuyM5frOCNHU' },
  { urls: 'turns:global.relay.metered.ca:443?transport=tcp', username: '370eaf7b79b525ebcdda4228', credential: 'QFVpUuyM5frOCNHU' },
];
