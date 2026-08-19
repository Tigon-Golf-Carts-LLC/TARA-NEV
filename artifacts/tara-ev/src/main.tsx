import { createRoot } from 'react-dom/client';

import App from './App';

// HTTPS backstop. GitHub Pages 301s http→https at the edge once "Enforce
// HTTPS" is enabled in the repo's Pages settings, which is the real fix — but
// that box can only be ticked after the TLS certificate is issued, and it can
// silently untick itself if the custom domain is ever re-saved. This catches
// that window. It runs from the bundle rather than an inline <script> so the
// build's script-src 'self' policy needs no hash exemption.
if (
  window.location.protocol === 'http:' &&
  window.location.hostname !== 'localhost' &&
  window.location.hostname !== '127.0.0.1' &&
  // Bare IPs and *.local have no publicly-issued certificate to upgrade to.
  !/^\[?[0-9a-f:.]+\]?$/i.test(window.location.hostname) &&
  !window.location.hostname.endsWith('.local')
) {
  window.location.replace(
    `https://${window.location.host}${window.location.pathname}${window.location.search}${window.location.hash}`,
  );
} else {
  createRoot(document.getElementById('root')!).render(<App />);
}
